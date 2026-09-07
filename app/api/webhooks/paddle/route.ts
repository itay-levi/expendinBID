import { NextResponse } from 'next/server'
import { verifyPaddleWebhook } from '@/lib/webhooks/verifyPaddleWebhook'
import { getRepositories } from '@/lib/repository'
import { broadcaster } from '@/lib/realtime/broadcaster'
import { notifyDefenderOfTakeover } from '@/lib/notifications/retaliationNotifier'
import { resolveBrandMetadata } from '@/lib/brand/resolveBrandMetadata'
import { requiredPriceForHex, priceForBulkCluster, PROTECTION_DURATION_MS } from '@/lib/pricing/takeoverPricing'
import {
  buildOwnerLookup,
  verifyTakeoverStillValid,
  type HexFingerprint,
} from '@/lib/hex/takeoverGuard'
import { logger } from '@/lib/logger'
import type { Empire, HexTile } from '@/types/game'

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
    custom_data?: {
      hexIds?: string[]
      targetUrl?: string
      protect?: boolean | string
      expectedHexState?: string
    }
  }
}

function isTakeoverMetadata(
  metadata: PaddleWebhookEvent['data']['custom_data'],
): metadata is { hexIds: string[]; targetUrl: string; protect?: boolean | string; expectedHexState?: string } {
  return Boolean(metadata && Array.isArray(metadata.hexIds) && typeof metadata.targetUrl === 'string')
}

function parseExpectedState(raw: string | undefined): Map<string, HexFingerprint> {
  if (!raw) return new Map()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Map()
    return new Map(
      parsed
        .filter((f): f is HexFingerprint => Boolean(f) && typeof (f as HexFingerprint).hexId === 'string')
        .map((f) => [f.hexId, f]),
    )
  } catch {
    return new Map()
  }
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
  const rawBody = await request.text()
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

  const { hexes: hexRepository, empires: empireRepository, ledger } = await getRepositories()

  // Idempotency. Paddle retries on any non-2xx, so a delivery that succeeded but timed out on our
  // side WILL arrive again — and applying a takeover twice would charge once and escalate the hex
  // price twice. The claim is a unique-constraint INSERT, not a prior "have I seen this?" read,
  // because two concurrent retries would both pass a read-then-write check.
  const webhookId = request.headers.get('paddle-event-id') ?? extractEventId(rawBody)
  if (webhookId) {
    const claimed = await ledger.claimWebhookEvent(webhookId)
    if (!claimed) {
      logger.info('ignoring duplicate webhook delivery', { webhookId })
      return NextResponse.json({ received: true, duplicate: true })
    }
  } else {
    // No id to deduplicate on: proceed, but say so — this is the one path where a retry could
    // double-apply, and it should be visible rather than silent.
    logger.warn('webhook has no event id — cannot deduplicate this delivery')
  }

  try {
    // Re-resolve metadata here too rather than trusting whatever the checkout step embedded —
    // by the time a webhook fires (seconds to minutes later), it's cheap insurance against a
    // tampered or stale metadata payload actually changing map state.
    const metadata = await resolveBrandMetadata(targetUrl)
    const attacker = await empireRepository.getOrCreateForUrl(targetUrl, metadata)

    const hexes = await Promise.all(hexIds.map((id) => hexRepository.getHexById(id)))
    const missingIndex = hexes.findIndex((h) => h === null)
    if (missingIndex !== -1) {
      logger.error('payment.succeeded referenced an unknown hex', { hexId: hexIds[missingIndex] })
      return NextResponse.json({ error: 'Unknown hex in payment metadata' }, { status: 422 })
    }
    const foundHexes = hexes as HexTile[]

    // Re-validate everything the checkout step assumed. A payment can settle minutes after the
    // session was created, and in that window the hex can be taken by a faster payment, escalate
    // in price, or become protected. Applying blindly here is what would let a second buyer pay a
    // stale price and still win the tile.
    const expectedByHexId = parseExpectedState(event.data.custom_data.expectedHexState)
    // Neighbours of the purchased hexes only — never the whole map. See the same note in
    // app/api/checkout/create-session/route.ts.
    const ownerAt = buildOwnerLookup(await hexRepository.getNeighborOwners(foundHexes.map((hex) => hex.coord)))
    const conflicts: string[] = []
    for (const hex of foundHexes) {
      const check = verifyTakeoverStillValid({
        hex,
        expected: expectedByHexId.get(hex.id),
        acquiringEmpireId: attacker.id,
        ownerAt,
      })
      if (!check.ok) conflicts.push(check.reason)
    }

    if (conflicts.length > 0) {
      // Deliberately NOT applied. The payment was captured, so this needs reconciliation — a
      // refund via Paddle's API, which this scaffold does not yet call. Surfacing it loudly beats
      // silently granting a takeover whose preconditions no longer hold. 200 so Paddle stops
      // retrying: retrying cannot fix a state conflict, it would just replay it forever.
      logger.error('Paid takeover REJECTED at settlement — payment needs refund/reconciliation', {
        hexIds,
        targetUrl,
        conflicts,
      })
      return NextResponse.json({ received: true, applied: false, reason: 'state_conflict', conflicts })
    }

    const lockedUntil = protect ? new Date(Date.now() + PROTECTION_DURATION_MS).toISOString() : null
    const pricePerHex =
      foundHexes.length > 1
        ? Math.round(priceForBulkCluster(foundHexes) / foundHexes.length) // even split across the bundle for the per-tile ledger
        : null

    for (const hex of foundHexes) {
      // Capture the previous owner BEFORE applyTakeover overwrites ownerId — otherwise there is
      // nothing left to notify.
      const defenderEmpire: Empire | null = hex.ownerId ? await empireRepository.getById(hex.ownerId) : null
      const price = pricePerHex ?? requiredPriceForHex(hex)

      const updated = await hexRepository.applyTakeover(hex.id, {
        ownerId: attacker.id,
        lastPricePaidCents: price,
        isContested: false,
        ownedSince: new Date().toISOString(),
        lockedUntil,
      })

      // The ledger is what the ticker, the leaderboard and every market figure are derived from,
      // so it is written as part of applying the takeover rather than reconstructed later.
      await hexRepository.recordTakeover({
        coord: hex.coord,
        attackerEmpireId: attacker.id,
        defenderEmpireId: defenderEmpire?.id ?? null,
        pricePaidCents: price,
      })

      await broadcaster.publish({ type: 'hex:updated', hex: updated })
      if (defenderEmpire) await notifyDefenderOfTakeover(defenderEmpire, updated, attacker)
    }

    return NextResponse.json({ received: true })
  } catch (error: unknown) {
    logger.error('Failed to apply paid takeover', { error: error instanceof Error ? error.message : String(error) })
    // Return 500 so Paddle retries delivery — the alternative (200) would silently drop a paid takeover.
    return NextResponse.json({ error: 'Failed to apply takeover' }, { status: 500 })
  }
}
