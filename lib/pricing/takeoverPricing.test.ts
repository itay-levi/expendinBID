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
  nextTileCostCents,
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

describe('priceForSelection — escalating land grab', () => {
  const unowned = { ownerId: null, lastPricePaidCents: BASE_HEX_PRICE_CENTS }
  const owned = { ownerId: 'rival.com', lastPricePaidCents: 2_000 }

  it('charges 1x, 2x, 3x, 4x down the claim', () => {
    // The model, exactly as specified: four tiles of open ground at $10 base cost
    // $10 + $20 + $30 + $40 = $100, not $40.
    const price = priceForSelection(Array.from({ length: 4 }, () => unowned))
    expect(price.lines.map((line) => line.multiplier)).toEqual([1, 2, 3, 4])
    expect(price.totalCents).toBe(BASE_HEX_PRICE_CENTS * (1 + 2 + 3 + 4))
    expect(price.totalCents).toBe(100_00)
  })

  it('grows faster than linearly, which is the whole point', () => {
    const one = priceForSelection([unowned]).totalCents
    const ten = priceForSelection(Array.from({ length: 10 }, () => unowned)).totalCents
    expect(ten).toBeGreaterThan(one * 10)
    expect(ten).toBe(BASE_HEX_PRICE_CENTS * 55) // 1+2+...+10
  })

  it('reports the premium separately from the flat rate', () => {
    const price = priceForSelection(Array.from({ length: 4 }, () => unowned))
    expect(price.flatCents).toBe(BASE_HEX_PRICE_CENTS * 4)
    expect(price.escalationCents).toBe(price.totalCents - price.flatCents)
    expect(price.escalationCents).toBeGreaterThan(0)
  })

  it('charges more for a rival tile than for open ground', () => {
    // A takeover starts from 1.5x what the current owner paid, so contested ground is always
    // dearer than settling empty space, and gets dearer each time it changes hands.
    expect(priceForSelection([owned]).totalCents).toBeGreaterThan(priceForSelection([unowned]).totalCents)
    expect(priceForSelection([owned]).lines[0]?.isTakeover).toBe(true)
    expect(priceForSelection([unowned]).lines[0]?.isTakeover).toBe(false)
  })

  it('prices a basket the same however it was clicked', () => {
    // Order-independence matters commercially: without it a buyer could shuffle their selection
    // to land the expensive tiles on the low multipliers and pay less for the same ground.
    const a = priceForSelection([owned, unowned, unowned])
    const b = priceForSelection([unowned, owned, unowned])
    const c = priceForSelection([unowned, unowned, owned])
    expect(a.totalCents).toBe(b.totalCents)
    expect(b.totalCents).toBe(c.totalCents)
  })

  it('always costs more as the claim grows', () => {
    let previous = 0
    for (let count = 1; count <= 60; count += 1) {
      const { totalCents } = priceForSelection(Array.from({ length: count }, () => unowned))
      expect(totalCents).toBeGreaterThan(previous)
      previous = totalCents
    }
  })

  it('stays monotonic with mixed cheap and expensive tiles', () => {
    const pool = [unowned, owned, { ownerId: 'x.com', lastPricePaidCents: 90_000 }, unowned]
    let previous = 0
    for (let count = 1; count <= 30; count += 1) {
      const hexes = Array.from({ length: count }, (_, i) => pool[i % pool.length] as typeof unowned)
      const { totalCents } = priceForSelection(hexes)
      expect(totalCents).toBeGreaterThan(previous)
      previous = totalCents
    }
  })

  it('quotes what one more tile of open ground would add', () => {
    expect(nextTileCostCents(0)).toBe(BASE_HEX_PRICE_CENTS)
    expect(nextTileCostCents(3)).toBe(BASE_HEX_PRICE_CENTS * 4)
  })

  it('handles an empty selection', () => {
    const price = priceForSelection([])
    expect(price.totalCents).toBe(0)
    expect(price.lines).toEqual([])
  })
})
