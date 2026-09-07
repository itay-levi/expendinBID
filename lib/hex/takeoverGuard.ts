import { hexIdFor } from './hexIdentity'
import type { HexTile } from '@/types/game'
import { checkHexEligibility, ELIGIBILITY_MESSAGES } from './territoryEligibility'
import { isHexLocked } from '@/lib/pricing/takeoverPricing'
import { type AxialCoord } from './hexMath'

/**
 * The compare-and-swap fingerprint for a hex, captured when a checkout session is created and
 * re-checked when the payment webhook lands.
 *
 * Between those two moments — which can be minutes apart while someone types their card details —
 * the hex can change underneath the buyer: a faster payment can take it, its price can escalate,
 * or its owner can buy protection. Without this, the webhook blindly applies whatever the session
 * assumed, which lets a second buyer pay a stale (lower) price and still win the tile. That is the
 * concurrency problem flagged as risk #1 in ARCHITECTURE.md §1.
 */
export type HexFingerprint = {
  hexId: string
  ownerId: string | null
  lastPricePaidCents: number
}

export function fingerprintHex(hex: HexTile): HexFingerprint {
  return { hexId: hex.id, ownerId: hex.ownerId, lastPricePaidCents: hex.lastPricePaidCents }
}

export function fingerprintHexes(hexes: HexTile[]): HexFingerprint[] {
  return hexes.map(fingerprintHex)
}

export type TakeoverCheck = { ok: true } | { ok: false; reason: string }

/**
 * Re-validates, at payment-settlement time, everything the checkout step assumed. Returns a
 * failure rather than throwing so the caller can decide how to reconcile (log + refund), which is
 * always safer than applying a takeover whose preconditions no longer hold.
 */
export function verifyTakeoverStillValid(args: {
  hex: HexTile
  expected: HexFingerprint | undefined
  acquiringEmpireId: string | null
  ownerAt: (coord: AxialCoord) => string | null | undefined
  now?: Date
}): TakeoverCheck {
  const { hex, expected, acquiringEmpireId, ownerAt, now = new Date() } = args

  if (!expected) return { ok: false, reason: `No recorded pre-payment state for ${hex.id}` }
  if (expected.hexId !== hex.id) return { ok: false, reason: `Fingerprint/hex mismatch for ${hex.id}` }

  // Someone else took it between checkout and settlement.
  if (hex.ownerId !== expected.ownerId) {
    return { ok: false, reason: `${hex.id} changed hands before payment settled` }
  }

  // The price moved, so the amount actually collected no longer matches what this hex costs.
  if (hex.lastPricePaidCents !== expected.lastPricePaidCents) {
    return { ok: false, reason: `${hex.id} price changed before payment settled` }
  }

  // The defender bought protection in the meantime.
  if (isHexLocked(hex, now)) {
    return { ok: false, reason: `${hex.id} became protected before payment settled` }
  }

  // Territory can shift underneath a pending payment, so adjacency is re-checked too.
  const eligibility = checkHexEligibility(hex.coord, ownerAt, acquiringEmpireId)
  if (!eligibility.eligible) {
    return { ok: false, reason: `${hex.id}: ${ELIGIBILITY_MESSAGES[eligibility.reason]}` }
  }

  return { ok: true }
}

export function buildOwnerLookup(ownerByHexId: ReadonlyMap<string, string>): (coord: AxialCoord) => string | null {
  return (coord) => ownerByHexId.get(hexIdFor(coord)) ?? null
}
