import { describe, expect, it } from 'vitest'
import { checkSelectionEligibility, countDisconnectedGroups } from './selectionEligibility'
import { axialKey, type AxialCoord } from './hexMath'
import { hexesInRadius } from './bulkClusters'

const origin: AxialCoord = { q: 0, r: 0 }

/** Builds a `getOwnerAt` from an explicit coord -> owner map. */
function owners(entries: Array<[AxialCoord, string]>) {
  const byKey = new Map(entries.map(([coord, owner]) => [axialKey(coord), owner]))
  return (coord: AxialCoord) => byKey.get(axialKey(coord)) ?? null
}

/** A buyer who owns nothing and has selected nothing — entitled to one free placement. */
const freshBuyer = { selectedKeys: new Set<string>() }

const rivalRing: Array<[AxialCoord, string]> = [
  [{ q: 1, r: 0 }, 'rival.com'],
  [{ q: 1, r: -1 }, 'rival.com'],
  [{ q: 0, r: -1 }, 'rival.com'],
  [{ q: -1, r: 0 }, 'rival.com'],
  [{ q: -1, r: 1 }, 'rival.com'],
  [{ q: 0, r: 1 }, 'rival.com'],
]

describe('checkSelectionEligibility', () => {
  it('lets a brand-new buyer plant one tile on open ground', () => {
    expect(checkSelectionEligibility(origin, owners([]), null, freshBuyer)).toEqual({
      eligible: true,
      reason: 'frontier',
    })
  })

  it('lets that buyer extend from their own basket, with no empire id yet', () => {
    const context = { selectedKeys: new Set([axialKey(origin)]) }
    expect(checkSelectionEligibility({ q: 1, r: 0 }, owners([]), null, context)).toEqual({
      eligible: true,
      reason: 'expansion',
    })
  })

  it('ALLOWS a second isolated tile — scattering is priced, not forbidden', () => {
    // Deliberate product decision: isolated tiles are genuinely valuable, so refusing the sale
    // just turns demand away. The premium for spreading out lives in priceForSelection instead.
    const context = { selectedKeys: new Set([axialKey(origin)]) }
    expect(checkSelectionEligibility({ q: 20, r: 20 }, owners([]), null, context).eligible).toBe(true)
  })

  it('ALLOWS a remote placement for an empire that already holds ground', () => {
    expect(
      checkSelectionEligibility({ q: 50, r: -50 }, owners([]), 'acme.com', { selectedKeys: new Set() }).eligible,
    ).toBe(true)
  })

  it('lets an established empire extend from territory it already owns', () => {
    const context = { selectedKeys: new Set<string>() }
    expect(
      checkSelectionEligibility({ q: 1, r: 0 }, owners([[origin, 'acme.com']]), 'acme.com', context),
    ).toEqual({ eligible: true, reason: 'expansion' })
  })

  it('still blocks a tile buried inside a rival empire', () => {
    const context = { selectedKeys: new Set([axialKey({ q: 9, r: 9 })]) }
    expect(checkSelectionEligibility(origin, owners(rivalRing), 'acme.com', context)).toEqual({
      eligible: false,
      reason: 'blocked',
    })
  })

  it('unblocks an enclosed tile once the basket includes a route to it', () => {
    const context = { selectedKeys: new Set([axialKey({ q: 1, r: 0 })]) }
    expect(checkSelectionEligibility(origin, owners(rivalRing), 'acme.com', context)).toEqual({
      eligible: true,
      reason: 'expansion',
    })
  })

  it('does not treat a non-adjacent basket tile as a route', () => {
    const context = { selectedKeys: new Set([axialKey({ q: 2, r: 0 })]) }
    expect(
      checkSelectionEligibility(origin, owners([[{ q: 1, r: 0 }, 'rival.com']]), 'acme.com', context),
    ).toEqual({ eligible: false, reason: 'blocked' })
  })

})

describe('countDisconnectedGroups', () => {
  it('counts one group for a contiguous cluster', () => {
    expect(countDisconnectedGroups(hexesInRadius(origin, 1))).toBe(1)
  })

  it('counts each isolated tile separately', () => {
    expect(countDisconnectedGroups([origin, { q: 20, r: 0 }, { q: -20, r: 5 }])).toBe(3)
  })

  it('joins tiles that touch', () => {
    expect(countDisconnectedGroups([origin, { q: 1, r: 0 }])).toBe(1)
  })

  it('handles an empty selection', () => {
    expect(countDisconnectedGroups([])).toBe(0)
  })
})
