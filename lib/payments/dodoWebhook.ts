import { verifyStandardWebhook, type StandardWebhookHeaders } from '@/lib/webhooks/verifyStandardWebhook'
import { parseFingerprints } from '@/lib/hex/takeoverGuard'
import { resolveBrandMetadataOrFallback, type ResolvedBrandMetadata } from '@/lib/brand/resolveBrandMetadata'
import { logger } from '@/lib/logger'
import { CHECKOUT_CURRENCY } from './dodoClient'
import { settleTakeover } from './settleTakeover'
import type { Repositories } from '@/lib/repository'

export type WebhookOutcome = { status: number; body: Record<string, unknown> }

export type DodoWebhookDeps = {
  secret: string | undefined
  /** Lazy, so a forged request is rejected before it costs a database connection. */
  getRepositories: () => Promise<Repositories>
  /** Test seam; defaults to the SSRF-guarded scraper with a hostname fallback. */
  resolveMetadata?: (url: string) => Promise<ResolvedBrandMetadata>
  now?: Date
}

/** What checkout wrote into the session's metadata, validated. Null means "cannot settle this". */
export type DodoTakeoverMetadata = {
  hexIds: string[]
  targetUrl: string
  protect: boolean
  primaryColorHex: string | undefined
  expectedHexState: string
  quotedTotalCents: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const ok = (body: Record<string, unknown>): WebhookOutcome => ({ status: 200, body })

/**
 * Dodo metadata is flat, so the basket travels as a JSON string. Everything is re-validated here
 * even though checkout wrote it: it comes back through an external service, and a settlement built
 * on a malformed field could hand territory to the wrong place.
 */
export function readDodoTakeoverMetadata(raw: unknown): DodoTakeoverMetadata | null {
  if (!isRecord(raw)) return null

  let hexIds: unknown = raw.hexIds
  if (typeof hexIds === 'string') {
    try {
      hexIds = JSON.parse(hexIds)
    } catch {
      return null
    }
  }
  if (!Array.isArray(hexIds) || hexIds.length === 0 || !hexIds.every((id) => typeof id === 'string')) return null

  if (typeof raw.targetUrl !== 'string') return null
  try {
    const url = new URL(raw.targetUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  } catch {
    return null
  }

  const quotedTotalCents = Number(raw.quotedTotalCents)
  if (!Number.isInteger(quotedTotalCents) || quotedTotalCents <= 0) return null

  return {
    hexIds: hexIds as string[],
    targetUrl: raw.targetUrl,
    protect: raw.protect === true || raw.protect === 'true',
    primaryColorHex: typeof raw.primaryColorHex === 'string' ? raw.primaryColorHex : undefined,
    expectedHexState: typeof raw.expectedHexState === 'string' ? raw.expectedHexState : '',
    quotedTotalCents,
  }
}

/**
 * Handles one Dodo Payments webhook delivery. The route is a thin wrapper around this.
 *
 * Only `payment.succeeded` grants territory. `dispute.opened` blocks the buyer's domain from future
 * purchases (Terms §7). Refunds are logged loudly: every sale is final, so a refund should only ever
 * be one issued deliberately from the Dodo dashboard. Everything else is acknowledged and ignored.
 */
export async function handleDodoWebhook(
  rawBody: string,
  headers: StandardWebhookHeaders,
  deps: DodoWebhookDeps,
): Promise<WebhookOutcome> {
  if (!deps.secret) {
    // Fail closed. Treating "unconfigured" as "allow" would turn a missing env var into free hexes.
    logger.error('DODO_PAYMENTS_WEBHOOK_SECRET is not configured — refusing webhook')
    return { status: 500, body: { error: 'Webhook not configured' } }
  }

  const verification = verifyStandardWebhook(rawBody, headers, deps.secret, deps.now)
  if (!verification.valid) {
    logger.warn('Rejected Dodo webhook', { reason: verification.reason })
    return { status: 401, body: { error: 'Invalid signature' } }
  }

  let event: unknown
  try {
    event = JSON.parse(rawBody)
  } catch {
    return { status: 400, body: { error: 'Invalid JSON' } }
  }
  const type = isRecord(event) && typeof event.type === 'string' ? event.type : ''
  const data = isRecord(event) && isRecord(event.data) ? event.data : {}

  const repositories = await deps.getRepositories()

  // The id is part of the signed content, so it is safe to deduplicate on. Namespaced so it can
  // never collide with a Paddle event id in the same table.
  const eventKey = `dodo:${headers.id as string}`
  if (!(await repositories.ledger.claimWebhookEvent(eventKey))) {
    logger.info('ignoring duplicate Dodo webhook delivery', { eventKey })
    return ok({ received: true, duplicate: true })
  }

  try {
    if (type === 'payment.succeeded') return await settlePayment(data, repositories, deps)
    if (type === 'dispute.opened') return await blockDisputingBuyer(data, repositories)
    if (type.startsWith('dispute.')) {
      logger.warn('Dodo dispute update', { type, paymentId: data.payment_id ?? null })
      return ok({ received: true })
    }
    if (type.startsWith('refund.')) {
      logger.warn('Dodo refund event — all sales are final; confirm this refund was issued on purpose', {
        type,
        paymentId: data.payment_id ?? null,
      })
      return ok({ received: true })
    }
    return ok({ received: true, ignored: type })
  } catch (error: unknown) {
    // Hand the claim back so Dodo's retry is processed instead of being dropped as a duplicate.
    await repositories.ledger.releaseWebhookEvent(eventKey).catch(() => undefined)
    logger.error('Failed to process Dodo webhook', {
      type,
      error: error instanceof Error ? error.message : String(error),
    })
    return { status: 500, body: { error: 'Failed to process webhook' } }
  }
}

async function settlePayment(
  data: Record<string, unknown>,
  repositories: Repositories,
  deps: DodoWebhookDeps,
): Promise<WebhookOutcome> {
  const paymentId = typeof data.payment_id === 'string' ? data.payment_id : null
  const metadata = readDodoTakeoverMetadata(data.metadata)

  // 200 for everything below that a retry cannot fix, so Dodo stops redelivering; each one is
  // logged as needing a human.
  if (!paymentId || !metadata) {
    logger.error('payment.succeeded without usable takeover metadata — needs manual reconciliation', { paymentId })
    return ok({ received: true, applied: false, reason: 'missing_metadata' })
  }

  if (typeof data.status === 'string' && data.status !== 'succeeded') {
    return ok({ received: true, applied: false, reason: 'not_succeeded' })
  }

  // Anti-fraud: the amount actually collected must cover what checkout quoted, in the currency it
  // was quoted in. A misconfigured product (a pay-what-you-want price the customer could lower, a
  // currency override) would otherwise deliver territory for less than it costs. Tax, if added on
  // top, only makes the total larger.
  const paidCents = Number(data.total_amount)
  const currency = typeof data.currency === 'string' ? data.currency.toUpperCase() : ''
  if (currency !== CHECKOUT_CURRENCY || !Number.isFinite(paidCents) || paidCents < metadata.quotedTotalCents) {
    logger.error('Dodo payment does not cover the quote — territory NOT applied', {
      paymentId,
      paidCents,
      currency,
      quotedTotalCents: metadata.quotedTotalCents,
    })
    return ok({ received: true, applied: false, reason: 'amount_mismatch' })
  }

  const resolveMetadata = deps.resolveMetadata ?? resolveBrandMetadataOrFallback
  const result = await settleTakeover(repositories, {
    hexIds: metadata.hexIds,
    targetUrl: metadata.targetUrl,
    metadata: await resolveMetadata(metadata.targetUrl),
    primaryColorHex: metadata.primaryColorHex,
    protect: metadata.protect,
    expected: parseFingerprints(metadata.expectedHexState),
    now: deps.now,
  })

  if (!result.applied) {
    // Captured but not deliverable — the tiles moved while the buyer was paying. Never granted
    // silently; this needs a refund or a manual grant from the dashboard.
    logger.error('Paid Dodo takeover REJECTED at settlement — needs reconciliation', {
      paymentId,
      reason: result.reason,
      conflicts: result.conflicts,
    })
    return ok({ received: true, applied: false, reason: result.reason })
  }

  try {
    await repositories.audit.recordSettledPayment({
      provider: 'dodo',
      paymentId,
      empireId: result.empire.id,
      amountCents: paidCents,
      currency,
      hexIds: metadata.hexIds,
    })
  } catch (error: unknown) {
    // The territory is delivered; failing now would only make the retry log a false conflict.
    logger.error('Could not record settled Dodo payment — a dispute on it will not be traceable', {
      paymentId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return ok({ received: true, applied: true })
}

/**
 * A chargeback on territory that was delivered as described. The buyer's domain is refused at
 * checkout from now on (Terms §7). Their current tiles are left for a human to decide on: removing
 * them automatically would punish a buyer whose card was genuinely stolen by someone else.
 */
async function blockDisputingBuyer(data: Record<string, unknown>, repositories: Repositories): Promise<WebhookOutcome> {
  const paymentId = typeof data.payment_id === 'string' ? data.payment_id : null
  if (!paymentId) {
    logger.error('dispute.opened without a payment_id')
    return ok({ received: true })
  }

  const payment = await repositories.audit.findSettledPayment('dodo', paymentId)
  if (!payment) {
    logger.error('dispute.opened on a payment with no settlement record', { paymentId })
    return ok({ received: true })
  }

  const empire = await repositories.empires.getById(payment.empireId)
  const domain = empire?.domain ?? payment.empireId
  await repositories.audit.blockDomain(domain, 'chargeback', paymentId)
  logger.error('CHARGEBACK — domain blocked from future purchases', { domain, paymentId, hexIds: payment.hexIds })
  return ok({ received: true, blocked: true })
}
