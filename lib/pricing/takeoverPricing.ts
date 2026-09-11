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
 * Premium per extra billboard, as a fraction of the escalated subtotal.
 *
 * A claim spread across five separate patches of map is five billboards, not one. Each renders its
 * own full-size logo in its own part of the screen, which is strictly more visibility than the same
 * tile count packed together — so it costs more. At 35% per extra placement, four scattered tiles
 * cost roughly twice what four adjacent ones do.
 */
export const SPREAD_PREMIUM_RATE = 0.35

export type SelectionPrice = {
  subtotalCents: number
  /** What the same tiles would cost with no escalation — the baseline the premium is measured from. */
  flatCents: number
  /** Everything charged above the flat rate. This is the land-grab premium. */
  escalationCents: number
  /** Separate patches of map this claim covers — each one is its own billboard. */
  billboardCount: number
  /** Charged for occupying several places on the map at once. */
  spreadCents: number
  totalCents: number
  /** Per-tile breakdown in charge order, so the UI can show exactly why the total is what it is. */
  lines: Array<{ unitCents: number; multiplier: number; chargedCents: number; isTakeover: boolean }>
}

/**
 * Price for a set of hexes, escalating with every tile claimed.
 *
 * THE GAME IS THE PRICE. Each additional tile in a claim costs a multiple of its own base: the
 * first at 1x, the second at 2x, the third at 3x. Four unclaimed tiles are therefore
 * $10 + $20 + $30 + $40 = $100, not $40. Visibility is the product, and the price of visibility
 * has to climb or the map gets bought out cheaply by whoever moves first.
 *
 * Two things compound:
 *
 *  - **Position in the claim.** The Nth tile costs N times its unit price.
 *  - **Whose ground it is.** An occupied tile's unit price is already 1.5x what its current owner
 *    paid (`requiredPriceForHex`), so taking territory off a rival is dearer than settling open
 *    ground, and gets dearer every time it changes hands.
 *
 * Tiles are sorted cheapest-first before multipliers are applied, so the total depends only on
 * WHICH tiles are claimed and never on the order they happened to be clicked in — otherwise the
 * same basket would quote two different prices, and a buyer could shuffle their way to a discount.
 *
 * The single source of truth for both the client preview and the server charge.
 */
export function priceForSelection(
  hexes: ReadonlyArray<{ ownerId: string | null; lastPricePaidCents: number }>,
  billboardCount = 1,
): SelectionPrice {
  const units = hexes
    .map((hex) => ({ unitCents: requiredPriceForHex(hex), isTakeover: hex.ownerId !== null }))
    .sort((a, b) => a.unitCents - b.unitCents)

  const lines = units.map((unit, index) => {
    const multiplier = index + 1
    return {
      unitCents: unit.unitCents,
      multiplier,
      chargedCents: unit.unitCents * multiplier,
      isTakeover: unit.isTakeover,
    }
  })

  const flatCents = lines.reduce((total, line) => total + line.unitCents, 0)
  const subtotalCents = lines.reduce((total, line) => total + line.chargedCents, 0)

  // Billboards beyond the first are what you pay the spread premium on. One contiguous block is
  // one placement however large it is, so packing tiles together is always the cheaper way to buy
  // the same amount of ground.
  const extraBillboards = Math.max(0, (hexes.length === 0 ? 0 : billboardCount) - 1)
  const spreadCents = Math.round(subtotalCents * extraBillboards * SPREAD_PREMIUM_RATE)

  return {
    subtotalCents,
    flatCents,
    escalationCents: subtotalCents - flatCents,
    billboardCount: hexes.length === 0 ? 0 : billboardCount,
    spreadCents,
    totalCents: subtotalCents + spreadCents,
    lines,
  }
}

/** What claiming one more tile of open ground would add, for the "next tile costs X" nudge. */
export function nextTileCostCents(currentCount: number): number {
  return BASE_HEX_PRICE_CENTS * (currentCount + 1)
}

export type BasketQuote = {
  /** What the territory itself costs — escalation and spread premium included. */
  territoryCents: number
  protectionCents: number
  totalCents: number
}

/**
 * Everything a basket costs, split the way checkout charges it.
 *
 * The one place the charge is computed. Checkout prices the session with it, settlement splits the
 * territory portion across the tiles with it, and the payment webhook checks the amount actually
 * paid against it — three callers that previously each did their own arithmetic, one of them with a
 * superseded formula that recorded a $100 purchase as $36.
 */
export function quoteForHexes(
  hexes: ReadonlyArray<{ ownerId: string | null; lastPricePaidCents: number }>,
  billboardCount: number,
  protect: boolean,
): BasketQuote {
  const territoryCents = priceForSelection(hexes, billboardCount).totalCents
  const protectionCents = protect ? PROTECTION_FEE_CENTS * hexes.length : 0
  return { territoryCents, protectionCents, totalCents: territoryCents + protectionCents }
}

/**
 * Splits a total into `parts` whole-cent shares that sum to it exactly.
 *
 * Used to record what each tile of a purchase cost. An even split, because that is what the buyer
 * paid for the block as a whole; rounding each share independently would lose or invent cents, and
 * the ledger these feed is where every revenue figure on the site comes from.
 */
export function splitEvenly(totalCents: number, parts: number): number[] {
  if (parts <= 0) return []
  const base = Math.floor(totalCents / parts)
  const remainder = totalCents - base * parts
  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0))
}
