import { describe, expect, it } from 'vitest'
import {
  BASE_HEX_PRICE_CENTS,
  PROTECTION_DURATION_MS,
  PROTECTION_FEE_CENTS,
  TAKEOVER_MULTIPLIER,
  assertTakeoverAllowed,
  formatCents,
  isBidSufficient,
  isHexLocked,
  nextVolumeTier,
  priceForBulkCluster,
  priceForSelection,
  priceForTakeover,
  requiredPriceForHex,
} from './takeoverPricing'

describe('requiredPriceForHex', () => {
  it('charges the base price for an unclaimed hex', () => {
    expect(requiredPriceForHex({ ownerId: null, lastPricePaidCents: 0 })).toBe(BASE_HEX_PRICE_CENTS)
  })

  it('charges exactly 1.5x the last price paid for an owned hex', () => {
    expect(requiredPriceForHex({ ownerId: 'a', lastPricePaidCents: 1000 })).toBe(1500)
    expect(requiredPriceForHex({ ownerId: 'a', lastPricePaidCents: 1500 })).toBe(2250)
  })

  it('rounds to whole cents (no fractional-cent charges)', () => {
    const price = priceForTakeover(1001) // 1501.5 -> must be an integer
    expect(Number.isInteger(price)).toBe(true)
    expect(price).toBe(1502)
  })

  it('escalates monotonically across repeated takeovers', () => {
    let price = BASE_HEX_PRICE_CENTS
    let previous = 0
    for (let i = 0; i < 10; i++) {
      expect(price).toBeGreaterThan(previous)
      previous = price
      price = priceForTakeover(price)
    }
    expect(TAKEOVER_MULTIPLIER).toBe(1.5)
  })
})

describe('isBidSufficient', () => {
  const hex = { ownerId: 'a', lastPricePaidCents: 1000 }

  it('accepts an exact-price bid', () => {
    expect(isBidSufficient(1500, hex)).toBe(true)
  })

  it('accepts an overpayment', () => {
    expect(isBidSufficient(5000, hex)).toBe(true)
  })

  it('rejects a bid one cent short', () => {
    expect(isBidSufficient(1499, hex)).toBe(false)
  })

  it('rejects zero and negative bids', () => {
    expect(isBidSufficient(0, hex)).toBe(false)
    expect(isBidSufficient(-100000, hex)).toBe(false)
  })
})

describe('protection lock', () => {
  it('reports an unlocked hex as unlocked', () => {
    expect(isHexLocked({ lockedUntil: null })).toBe(false)
  })

  it('reports a future lock as locked and a past lock as expired', () => {
    const future = new Date(Date.now() + PROTECTION_DURATION_MS).toISOString()
    const past = new Date(Date.now() - 1000).toISOString()
    expect(isHexLocked({ lockedUntil: future })).toBe(true)
    expect(isHexLocked({ lockedUntil: past })).toBe(false)
  })

  it('assertTakeoverAllowed throws only while protection is active', () => {
    const locked = { lockedUntil: new Date(Date.now() + 60_000).toISOString() }
    expect(() => assertTakeoverAllowed(locked)).toThrow(/protected/i)
    expect(() => assertTakeoverAllowed({ lockedUntil: null })).not.toThrow()
  })

  it('prices protection at the advertised $15.00 for 10 minutes', () => {
    expect(PROTECTION_FEE_CENTS).toBe(1500)
    expect(PROTECTION_DURATION_MS).toBe(10 * 60 * 1000)
  })
})

describe('priceForBulkCluster', () => {
  it('applies exactly a 10% discount to the summed per-hex price', () => {
    const hexes = [
      { ownerId: null, lastPricePaidCents: 0 },
      { ownerId: null, lastPricePaidCents: 0 },
      { ownerId: null, lastPricePaidCents: 0 },
    ]
    // 3 x $10.00 = $30.00, less 10% = $27.00
    expect(priceForBulkCluster(hexes)).toBe(2700)
  })

  it('never returns a discount larger than the subtotal, and stays an integer', () => {
    const hexes = [{ ownerId: 'a', lastPricePaidCents: 333 }]
    const price = priceForBulkCluster(hexes)
    expect(Number.isInteger(price)).toBe(true)
    expect(price).toBeGreaterThan(0)
    expect(price).toBeLessThan(requiredPriceForHex(hexes[0]!))
  })
})

describe('formatCents', () => {
  it('formats whole and fractional amounts to 2dp USD', () => {
    expect(formatCents(1000)).toBe('$10.00')
    expect(formatCents(1)).toBe('$0.01')
    expect(formatCents(0)).toBe('$0.00')
    expect(formatCents(1_234_567)).toBe('$12,345.67')
  })
})

describe('priceForSelection', () => {
  const unowned = { ownerId: null, lastPricePaidCents: BASE_HEX_PRICE_CENTS }
  const owned = { ownerId: 'rival.com', lastPricePaidCents: 2_000 }

  it('prices an arbitrary count, not just 1 / 7 / 19', () => {
    // The bug this replaces: any selection that was not exactly one hex or a perfect ring was
    // rejected outright as "not a valid cluster", so four tiles could not be bought at all.
    for (const count of [1, 2, 3, 4, 5, 6, 8, 13, 20, 77]) {
      const price = priceForSelection(Array.from({ length: count }, () => unowned))
      expect(price.totalCents).toBeGreaterThan(0)
    }
  })

  it('sums per-hex prices, mixing unclaimed and takeover targets', () => {
    const price = priceForSelection([unowned, owned])
    expect(price.subtotalCents).toBe(BASE_HEX_PRICE_CENTS + 3_000) // 2000 * 1.5
  })

  it('always costs more in absolute terms as the selection grows', () => {
    // The rule that has to hold across every discount boundary: more ground is never cheaper.
    let previous = 0
    for (let count = 1; count <= 60; count += 1) {
      const { totalCents } = priceForSelection(Array.from({ length: count }, () => unowned))
      expect(totalCents).toBeGreaterThan(previous)
      previous = totalCents
    }
  })

  it('improves the effective rate as the basket grows, without ever reaching the top tier', () => {
    // Marginal, not flat: the headline 20% applies only to tiles past the 50th, so the blended
    // rate across the whole basket approaches it from below and never equals it.
    const rate = (count: number) => priceForSelection(Array.from({ length: count }, () => unowned)).discountRate
    expect(rate(2)).toBe(0)
    expect(rate(3)).toBeGreaterThan(0)
    expect(rate(10)).toBeGreaterThan(rate(3))
    expect(rate(60)).toBeGreaterThan(rate(20))
    expect(rate(500)).toBeLessThan(0.2)
  })

  it('stays monotonic even when tile prices vary wildly', () => {
    // Mixed cheap unclaimed ground and expensive takeover targets, which is what a real basket
    // looks like once a map has been played on.
    const pool = [unowned, owned, { ownerId: 'x.com', lastPricePaidCents: 90_000 }, unowned, owned]
    let previous = 0
    for (let count = 1; count <= 40; count += 1) {
      const hexes = Array.from({ length: count }, (_, i) => pool[i % pool.length] as typeof unowned)
      const { totalCents } = priceForSelection(hexes)
      expect(totalCents).toBeGreaterThan(previous)
      previous = totalCents
    }
  })

  it('reports the next tier to reach, and null at the top', () => {
    expect(nextVolumeTier(1)?.minHexes).toBe(3)
    expect(nextVolumeTier(5)?.minHexes).toBe(7)
    expect(nextVolumeTier(20)?.minHexes).toBe(50)
    expect(nextVolumeTier(50)).toBeNull()
  })

  it('handles an empty selection', () => {
    expect(priceForSelection([])).toEqual({
      subtotalCents: 0,
      discountCents: 0,
      totalCents: 0,
      discountRate: 0,
    })
  })
})
