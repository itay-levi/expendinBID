import { describe, expect, it } from 'vitest'
import { PROTECTION_FEE_CENTS, priceForSelection, quoteForHexes, splitEvenly } from './takeoverPricing'

const open = { ownerId: null, lastPricePaidCents: 0 }

describe('quoteForHexes', () => {
  it('matches the selection price the claim bar shows', () => {
    const hexes = [open, open, open, open]
    expect(quoteForHexes(hexes, 1, false)).toEqual({
      territoryCents: priceForSelection(hexes, 1).totalCents,
      protectionCents: 0,
      totalCents: 10_000,
    })
  })

  it('adds protection per tile, on top of the territory', () => {
    const quote = quoteForHexes([open, open], 1, true)
    expect(quote.protectionCents).toBe(PROTECTION_FEE_CENTS * 2)
    expect(quote.totalCents).toBe(quote.territoryCents + quote.protectionCents)
  })

  it('charges the spread premium for scattered tiles', () => {
    expect(quoteForHexes([open, open], 2, false).territoryCents).toBeGreaterThan(
      quoteForHexes([open, open], 1, false).territoryCents,
    )
  })
})

describe('splitEvenly', () => {
  it('always sums to the total, to the cent', () => {
    for (const [total, parts] of [
      [10_000, 4],
      [10_001, 4],
      [1, 3],
      [999, 7],
      [0, 5],
    ] as const) {
      const shares = splitEvenly(total, parts)
      expect(shares).toHaveLength(parts)
      expect(shares.reduce((sum, share) => sum + share, 0)).toBe(total)
      expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1)
    }
  })

  it('returns nothing for zero parts', () => {
    expect(splitEvenly(100, 0)).toEqual([])
  })
})
