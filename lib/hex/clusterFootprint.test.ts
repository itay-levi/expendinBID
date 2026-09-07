import { describe, expect, it } from 'vitest'
import { computeClusterFootprint, plaqueSideForDepth } from './clusterFootprint'
import { hexesInRadius } from './bulkClusters'
import type { AxialCoord } from './hexMath'

const origin: AxialCoord = { q: 0, r: 0 }

describe('computeClusterFootprint', () => {
  it('treats a single hex as one ring deep, at compact detail', () => {
    const footprint = computeClusterFootprint([origin])
    expect(footprint).toEqual({ anchor: origin, depth: 1, detail: 'compact' })
  })

  it('finds the center of a 7-hex ring and gives it more room', () => {
    const footprint = computeClusterFootprint(hexesInRadius(origin, 1))
    expect(footprint.anchor).toEqual(origin)
    expect(footprint.depth).toBe(2)
    expect(footprint.detail).toBe('standard')
  })

  it('scales up for a 19-hex cluster', () => {
    const footprint = computeClusterFootprint(hexesInRadius(origin, 2))
    expect(footprint.anchor).toEqual(origin)
    expect(footprint.depth).toBe(3)
    expect(footprint.detail).toBe('full')
  })

  it('keeps a long thin chain at mark-only detail however many hexes it holds', () => {
    // 30 hexes in a straight line: a big empire with no room for a big logo. Sizing by hex count
    // (or by distance to the farthest hex) would splash a 30-wide plaque across the whole map.
    const chain = Array.from({ length: 30 }, (_, q) => ({ q, r: 0 }))
    const footprint = computeClusterFootprint(chain)
    expect(footprint.depth).toBe(1)
    expect(footprint.detail).toBe('compact')
  })

  it('anchors inside its own territory for a C-shaped cluster, not in the hollow', () => {
    // A ring of 6 with the center deliberately NOT owned. The mean of these coordinates is the
    // hollow center — which belongs to somebody else.
    const ring = hexesInRadius(origin, 1).filter((c) => !(c.q === 0 && c.r === 0))
    const footprint = computeClusterFootprint(ring)
    expect(footprint.anchor).not.toEqual(origin)
    expect(ring).toContainEqual(footprint.anchor)
  })

  it('picks the deepest lobe when territory is uneven', () => {
    // A fat 19-hex blob joined by a single-hex bridge to a lone outpost. The plaque belongs in
    // the blob, not on the bridge or the outpost.
    const blob = hexesInRadius(origin, 2)
    const bridge: AxialCoord[] = [{ q: 3, r: 0 }, { q: 4, r: 0 }]
    const footprint = computeClusterFootprint([...blob, ...bridge])
    expect(footprint.anchor).toEqual(origin)
    expect(footprint.detail).toBe('full')
  })

  it('rejects an empty cluster rather than returning a meaningless anchor', () => {
    expect(() => computeClusterFootprint([])).toThrow(/non-empty/)
  })
})

describe('plaqueSideForDepth', () => {
  it('fits inside a single hex at depth 1', () => {
    // A flat-top hex of size 1 measures sqrt(3) across the flats. Exceed that and a lone hex's
    // logo bleeds onto its neighbours — which, on this map, are other companies' territory.
    expect(plaqueSideForDepth(1, 1)).toBeLessThan(Math.sqrt(3))
  })

  it('fits inside the 7-hex cluster it describes at depth 2', () => {
    // A radius-1 cluster measures 3 * sqrt(3) across the flats.
    expect(plaqueSideForDepth(2, 1)).toBeLessThan(3 * Math.sqrt(3))
  })

  it('grows with clearance and scales linearly with hex size', () => {
    expect(plaqueSideForDepth(2, 1)).toBeGreaterThan(plaqueSideForDepth(1, 1))
    expect(plaqueSideForDepth(3, 1)).toBeGreaterThan(plaqueSideForDepth(2, 1))
    expect(plaqueSideForDepth(3, 2)).toBeCloseTo(2 * plaqueSideForDepth(3, 1), 6)
  })
})
