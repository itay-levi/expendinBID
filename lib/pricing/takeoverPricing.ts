// Pricing rules. This module is intentionally duplicated on the server: the client copy only
// ever produces a *preview* price for the UI. The server recomputes this from the authoritative
// DB row inside the row-locked transaction and never trusts a client-submitted amount — see
// ARCHITECTURE.md §8 and §12.

export const BASE_HEX_PRICE_CENTS = 1_000 // $10.00 — cost of an unclaimed hex
export const TAKEOVER_MULTIPLIER = 1.5

export function priceForEmptyHex(): number {
  return BASE_HEX_PRICE_CENTS
}

export function priceForTakeover(lastPricePaidCents: number): number {
  return Math.round(lastPricePaidCents * TAKEOVER_MULTIPLIER)
}

export function requiredPriceForHex(hex: { ownerId: string | null; lastPricePaidCents: number }): number {
  return hex.ownerId === null ? priceForEmptyHex() : priceForTakeover(hex.lastPricePaidCents)
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}

/**
 * Server-side guard: is this bid sufficient for the hex's *current* price? Always call this
 * against a freshly-read, row-locked hex — never against a price the client sent earlier.
 */
export function isBidSufficient(
  bidCents: number,
  hex: { ownerId: string | null; lastPricePaidCents: number },
): boolean {
  return bidCents >= requiredPriceForHex(hex)
}

// --- "Protect Hex" upsell (ARCHITECTURE.md §17) ---
export const PROTECTION_FEE_CENTS = 1_500 // $15.00
export const PROTECTION_DURATION_MS = 10 * 60 * 1000 // 10 minutes

export function isHexLocked(hex: { lockedUntil: string | null }, now: Date = new Date()): boolean {
  return hex.lockedUntil !== null && new Date(hex.lockedUntil) > now
}

/**
 * Locking blocks *execution* of a takeover only — it does not fabricate price growth. The
 * required price is still computed the normal way (priceForTakeover), so a real 1.5x bid the
 * moment protection expires reflects an actual prior payment, not an invented number. A true
 * "price climbs while a queue of rival bids waits" mechanic would need a real bid-queue data
 * model; that's a documented future enhancement, not something to fake with no bids behind it.
 */
export function assertTakeoverAllowed(hex: { lockedUntil: string | null }, now: Date = new Date()): void {
  if (isHexLocked(hex, now)) {
    throw new Error(`Hex is protected until ${new Date(hex.lockedUntil as string).toISOString()}`)
  }
}

// --- "Mass Conquer" bulk-cluster discount (ARCHITECTURE.md §17) ---
// 7 = a hex plus its immediate ring (radius 1); 19 = plus the next ring out (radius 2) — the
// discount tiers line up exactly with hexNeighbors()'s natural ring sizes, not arbitrary counts.
export const BULK_CLUSTER_SIZES = [7, 19] as const
export const BULK_DISCOUNT_RATE = 0.1 // 10% off the summed per-hex price

export function priceForBulkCluster(hexes: Array<{ ownerId: string | null; lastPricePaidCents: number }>): number {
  const subtotal = hexes.reduce((sum, hex) => sum + requiredPriceForHex(hex), 0)
  return Math.round(subtotal * (1 - BULK_DISCOUNT_RATE))
}

/**
 * Volume discount tiers: hex count -> fraction off the summed price.
 *
 * Ordered largest-threshold-first so the first match is the best applicable rate.
 */
export const VOLUME_TIERS: ReadonlyArray<{ minHexes: number; rate: number }> = [
  { minHexes: 50, rate: 0.2 },
  { minHexes: 19, rate: 0.15 },
  { minHexes: 7, rate: 0.1 },
  { minHexes: 3, rate: 0.05 },
]

/** Best discount rate a selection of this size earns. 0 for small selections. */
export function discountRateForCount(hexCount: number): number {
  return VOLUME_TIERS.find((tier) => hexCount >= tier.minHexes)?.rate ?? 0
}

/** The next tier a buyer could reach, for the "N more for X% off" nudge. Null at the top tier. */
export function nextVolumeTier(hexCount: number): { minHexes: number; rate: number } | null {
  const remaining = [...VOLUME_TIERS].reverse().find((tier) => hexCount < tier.minHexes)
  return remaining ?? null
}

export type SelectionPrice = {
  subtotalCents: number
  discountCents: number
  totalCents: number
  /** Effective rate across the whole basket, for display. Always below the top marginal tier. */
  discountRate: number
}

/**
 * Price for an arbitrary set of hexes.
 *
 * ANY set — not just a single tile or a perfect 7/19 ring. Gating purchases on exact cluster shapes
 * meant a buyer who selected four tiles was told their selection was invalid, which is absurd for a
 * product whose whole proposition is "claim as much as you want".
 *
 * Discounts are MARGINAL, like tax brackets: the first two tiles are full price, the next few carry
 * the 5% rate, and so on. A flat "best tier applies to everything" rate is the obvious approach and
 * it is wrong — at 1000 cents a tile it made 19 hexes (15% off 19000 = 16150) cost less than 18
 * (10% off 18000 = 16200), so a buyer adding territory got a refund. Marginal rates are monotonic
 * by construction: every extra tile adds `price * (1 - itsRate)`, which is always positive.
 *
 * The single source of truth for both the client preview and the server charge — sharing this is
 * what stops the two from drifting into disagreement over what a basket costs.
 */
export function priceForSelection(
  hexes: ReadonlyArray<{ ownerId: string | null; lastPricePaidCents: number }>,
): SelectionPrice {
  // Descending, so the deepest marginal rates land on the cheapest tiles. Sorting also makes the
  // price independent of the order the buyer happened to click in.
  const prices = hexes.map(requiredPriceForHex).sort((a, b) => b - a)

  let subtotalCents = 0
  let discountCents = 0
  prices.forEach((price, index) => {
    subtotalCents += price
    discountCents += Math.round(price * discountRateForCount(index + 1))
  })

  return {
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
    discountRate: subtotalCents > 0 ? discountCents / subtotalCents : 0,
  }
}
