import { NextResponse } from 'next/server'
import { verifyPaddleWebhook } from '@/lib/webhooks/verifyPaddleWebhook'
import { getRepositories } from '@/lib/repository'
import { resolveBrandMetadataOrFallback } from '@/lib/brand/resolveBrandMetadata'
import { parseFingerprints } from '@/lib/hex/takeoverGuard'
import { settleTakeover } from '@/lib/payments/settleTakeover'
import { BodyTooLargeError, readBodyWithLimit } from '@/lib/http/readBodyWithLimit'
import { logger } from '@/lib/logger'

/** Paddle events are a few kilobytes; anything near this is not one of them. */
const MAX_WEBHOOK_BYTES = 256 * 1024

// This is the ONLY place hex ownership actually changes for a paid takeover — never on the
// client's say-so. Everything here hinges on the signature check below being correct: skipping
// or weakening it would let anyone POST a fake "payment succeeded" event and take hexes for free.

// Paddle Billing envelope: `{ event_type, data: { custom_data } }`, where `custom_data` is echoed
// back verbatim from the transaction we created. UNVERIFIED against a live sandbox delivery from
// this account — replay one real webhook from Paddle's dashboard and confirm the field path before
// going live.
type PaddleWebhookEvent = {
  event_type: string
  data: {
    /** The transaction id, recorded so a later dispute can be traced to the buyer. */
    id?: string
    currency_code?: string
    /** Paddle reports money as strings of minor units (cents for USD). */
    details?: { totals?: { total?: string; grand_total?: string } }
    custom_data?: {
      hexIds?: string[]
      targetUrl?: string
      protect?: boolean | string
      expectedHexState?: string
      primaryColorHex?: string
      quotedTotalCents?: number | string
    }
  }
}

type TakeoverMetadata = NonNullable<PaddleWebhookEvent['data']['custom_data']> & {
  hexIds: string[]
  targetUrl: string
}

function isTakeoverMetadata(
  metadata: PaddleWebhookEvent['data']['custom_data'],
): metadata is TakeoverMetadata {
  return Boolean(metadata && Array.isArray(metadata.hexIds) && typeof metadata.targetUrl === 'string')
}

/**
 * Paddle's event id from the payload, as a fallback when the header isn't present.
 *
 * Safe to read from the body here specifically because this runs only after the signature has been
 * verified — before that, nothing in the body can be trusted.
 */
function extractEventId(rawBody: string): string | null {
  try {
    const parsed: unknown = JSON.parse(rawBody)
    const id = (parsed as { event_id?: unknown; data?: { id?: unknown } })?.event_id
    if (typeof id === 'string') return id
    const dataId = (parsed as { data?: { id?: unknown } })?.data?.id
    return typeof dataId === 'string' ? dataId : null
  } catch {
    return null
  }
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.PADDLE_WEBHOOK_SECRET
  if (!secret) {
    // Fail closed. Treating "unconfigured" as "allow" would turn a missing env var into free hexes.
    logger.error('PADDLE_WEBHOOK_SECRET is not configured — refusing webhook')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  // Signature verification needs the exact raw body string — read as text, not json(), and
  // parse that same string afterward rather than letting the framework parse it first.
  let rawBody: string
  try {
    rawBody = await readBodyWithLimit(request, MAX_WEBHOOK_BYTES)
  } catch (error: unknown) {
    if (error instanceof BodyTooLargeError) return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    throw error
  }
  const verification = verifyPaddleWebhook(rawBody, request.headers.get('paddle-signature'), secret)

  if (!verification.valid) {
    logger.warn('Rejected Paddle webhook with invalid signature', { reason: verification.reason })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: PaddleWebhookEvent
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Paddle sends every subscribed event type to the same endpoint; only a completed transaction
  // grants territory. Anything else is acknowledged so it isn't retried forever.
  if (event.event_type !== 'transaction.completed') {
    return NextResponse.json({ received: true, ignored: event.event_type })
  }

  if (!isTakeoverMetadata(event.data.custom_data)) {
    logger.error('transaction.completed event missing expected custom_data', { event })
    return NextResponse.json({ error: 'Missing takeover metadata' }, { status: 422 })
  }

  const { hexIds, targetUrl } = event.data.custom_data
  const protect = event.data.custom_data.protect === true || event.data.custom_data.protect === 'true'

  // Anti-fraud, mirroring the Dodo webhook: the amount Paddle actually collected must cover what
  // checkout quoted, in the quoted currency. A discount code or a partial collection must never
  // deliver territory for less than it costs. `grand_total` is after credits, `total` before them.
  const quotedCents = Number(event.data.custom_data.quotedTotalCents)
  const totals = event.data.details?.totals
  const paidCents = Number(totals?.grand_total ?? totals?.total)
  const currency = (event.data.currency_code ?? '').toUpperCase()
  const expectedCurrency = (process.env.PADDLE_CURRENCY_CODE ?? 'USD').toUpperCase()
  if (
    !Number.isInteger(quotedCents) ||
    quotedCents <= 0 ||
    !Number.isFinite(paidCents) ||
    paidCents < quotedCents ||
    currency !== expectedCurrency
  ) {
    logger.error('Paddle payment does not cover the quote — territory NOT applied', {
      transactionId: event.data.id ?? null,
      paidCents,
      quotedCents,
      currency,
    })
    // 200: a retry cannot change what was paid, so Paddle should stop redelivering.
    return NextResponse.json({ received: true, applied: false, reason: 'amount_mismatch' })
  }

  const repositories = await getRepositories()

  // Idempotency. Paddle retries on any non-2xx, so a delivery that succeeded but timed out on our
  // side WILL arrive again. The claim is a unique-constraint INSERT, not a prior "have I seen this?"
  // read, because two concurrent retries would both pass a read-then-write check.
  const webhookId = request.headers.get('paddle-event-id') ?? extractEventId(rawBody)
  if (webhookId) {
    const claimed = await repositories.ledger.claimWebhookEvent(webhookId)
    if (!claimed) {
      logger.info('ignoring duplicate webhook delivery', { webhookId })
      return NextResponse.json({ received: true, duplicate: true })
    }
  } else {
    // No id to deduplicate on: proceed, but say so — this is the one path where a retry could
    // double-apply, and it should be visible rather than silent. (Settlement's compare-and-swap
    // still refuses a second application of the same purchase.)
    logger.warn('webhook has no event id — cannot deduplicate this delivery')
  }

  try {
    // Same settlement path as Dodo and demo claims — see lib/payments/settleTakeover.ts. It
    // re-validates everything checkout assumed, under the row locks, and records the price that
    // was actually charged. A site that blocks scrapers falls back to its hostname rather than
    // failing every retry of a paid delivery.
    const result = await settleTakeover(repositories, {
      hexIds,
      targetUrl,
      metadata: await resolveBrandMetadataOrFallback(targetUrl),
      primaryColorHex: event.data.custom_data.primaryColorHex,
      protect,
      expected: parseFingerprints(event.data.custom_data.expectedHexState),
    })

    if (!result.applied) {
      if (result.reason === 'unknown_hex') {
        logger.error('payment referenced an unknown hex', { conflicts: result.conflicts })
        return NextResponse.json({ error: 'Unknown hex in payment metadata' }, { status: 422 })
      }
      // Deliberately NOT applied. The payment was captured, so this needs reconciliation — a refund
      // or a manual grant. 200 so Paddle stops retrying: a retry cannot fix a state conflict.
      logger.error('Paid takeover REJECTED at settlement — payment needs refund/reconciliation', {
        hexIds,
        targetUrl,
        conflicts: result.conflicts,
      })
      return NextResponse.json({ received: true, applied: false, reason: 'state_conflict', conflicts: result.conflicts })
    }

    const transactionId = typeof event.data.id === 'string' ? event.data.id : null
    if (transactionId) {
      await repositories.audit
        .recordSettledPayment({
          provider: 'paddle',
          paymentId: transactionId,
          empireId: result.empire.id,
          amountCents: result.territoryCents,
          currency: process.env.PADDLE_CURRENCY_CODE ?? 'USD',
          hexIds,
        })
        .catch((error: unknown) =>
          logger.error('Could not record settled Paddle payment', {
            transactionId,
            error: error instanceof Error ? error.message : String(error),
          }),
        )
    }

    return NextResponse.json({ received: true })
  } catch (error: unknown) {
    // Give the claim back, or Paddle's retry would be discarded as a duplicate and the buyer would
    // have paid for nothing. Then 500, so the retry happens.
    if (webhookId) await repositories.ledger.releaseWebhookEvent(webhookId).catch(() => undefined)
    logger.error('Failed to apply paid takeover', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to apply takeover' }, { status: 500 })
  }
}
