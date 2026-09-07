import { describe, expect, it } from 'vitest'
import { checkSelectionEligibility } from './selectionEligibility'
import { axialKey, type AxialCoord } from './hexMath'

const origin: AxialCoord = { q: 0, r: 0 }

/** Builds a `getOwnerAt` from an explicit coord -> owner map. */
function owners(entries: Array<[AxialCoord, string]>) {
  const byKey = new Map(entries.map(([coord, owner]) => [axialKey(coord), owner]))
  return (coord: AxialCoord) => byKey.get(axialKey(coord)) ?? null
}

const nothingSelected = new Set<string>()

describe('checkSelectionEligibility', () => {
  it('lets a brand-new buyer place a first pick on genuinely open ground', () => {
    const result = checkSelectionEligibility(origin, owners([]), null, nothingSelected)
    expect(result).toEqual({ eligible: true, reason: 'frontier' })
  })

  it('lets that buyer extend from their own basket, with no empire id yet', () => {
    // The case multi-select exists for: pick one hex, then the one next to it. Before the basket
    // counted toward reachability this came back blocked, because a first-time buyer owns nothing.
    const selected = new Set([axialKey(origin)])
    const result = checkSelectionEligibility({ q: 1, r: 0 }, owners([]), null, selected)
    expect(result).toEqual({ eligible: true, reason: 'expansion' })
  })

  it('lets an established empire extend from territory it already owns', () => {
    const result = checkSelectionEligibility(
      { q: 1, r: 0 },
      owners([[origin, 'acme.com']]),
      'acme.com',
      nothingSelected,
    )
    expect(result).toEqual({ eligible: true, reason: 'expansion' })
  })

  it('still blocks a tile buried inside a rival empire', () => {
    // Surrounded on all six sides by a rival, touching nothing of the acquirer's: the core rule,
    // and adding hexes to a basket elsewhere must not quietly unlock it.
    const rivalRing: Array<[AxialCoord, string]> = [
      [{ q: 1, r: 0 }, 'rival.com'],
      [{ q: 1, r: -1 }, 'rival.com'],
      [{ q: 0, r: -1 }, 'rival.com'],
      [{ q: -1, r: 0 }, 'rival.com'],
      [{ q: -1, r: 1 }, 'rival.com'],
      [{ q: 0, r: 1 }, 'rival.com'],
    ]
    const selectedFarAway = new Set([axialKey({ q: 9, r: 9 })])
    const result = checkSelectionEligibility(origin, owners(rivalRing), 'acme.com', selectedFarAway)
    expect(result).toEqual({ eligible: false, reason: 'blocked' })
  })

  it('unblocks an enclosed tile once the basket includes a route to it', () => {
    // Buying a rival's border tile puts it in the basket, which makes the tile behind it reachable
    // in the same transaction — fighting inward one tile at a time, as intended.
    const rivalRing: Array<[AxialCoord, string]> = [
      [{ q: 1, r: 0 }, 'rival.com'],
      [{ q: 1, r: -1 }, 'rival.com'],
      [{ q: 0, r: -1 }, 'rival.com'],
      [{ q: -1, r: 0 }, 'rival.com'],
      [{ q: -1, r: 1 }, 'rival.com'],
      [{ q: 0, r: 1 }, 'rival.com'],
    ]
    const selected = new Set([axialKey({ q: 1, r: 0 })])
    const result = checkSelectionEligibility(origin, owners(rivalRing), 'acme.com', selected)
    expect(result).toEqual({ eligible: true, reason: 'expansion' })
  })

  it('does not treat a diagonal (non-adjacent) basket hex as a route', () => {
    // Two rings out is not adjacent; selecting it must not make the target reachable.
    const selected = new Set([axialKey({ q: 2, r: 0 })])
    const result = checkSelectionEligibility(
      origin,
      owners([[{ q: 1, r: 0 }, 'rival.com']]),
      'acme.com',
      selected,
    )
    expect(result).toEqual({ eligible: false, reason: 'blocked' })
  })
})
