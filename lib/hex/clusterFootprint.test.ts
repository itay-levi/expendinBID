import { describe, expect, it } from 'vitest'
import { computeClusterFootprint, inscribedContentBox } from './clusterFootprint'
import { clusterWorldBounds } from './hexGeometry'
import { hexesInRadius } from './bulkClusters'
import { axialKey, axialToPixel, pixelToHex, type AxialCoord } from './hexMath'
import { HEX_SIZE } from './mapConfig'

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
    // Seven tiles is a substantial block and carries the full mark. It used to read 'standard',
    // because the tier was keyed to erosion depth, which needs nineteen tiles to reach 'full'.
    expect(footprint.detail).toBe('full')
  })

  it('shows the domain and description on a four-tile block', () => {
    // The reported problem: a buyer holding four or five tiles saw only a logo. Depth here is 1
    // (every tile touches open ground), which is exactly why depth was the wrong tier signal.
    const block = [origin, { q: 1, r: 0 }, { q: 0, r: 1 }, { q: 1, r: -1 }]
    const footprint = computeClusterFootprint(block)
    expect(footprint.depth).toBe(1)
    expect(footprint.detail).toBe('full')
  })

  it('keeps a lone hex at mark-only detail', () => {
    expect(computeClusterFootprint([origin, { q: 1, r: 0 }]).detail).toBe('standard')
  })

  it('scales up for a 19-hex cluster', () => {
    const footprint = computeClusterFootprint(hexesInRadius(origin, 2))
    expect(footprint.anchor).toEqual(origin)
    expect(footprint.depth).toBe(3)
    expect(footprint.detail).toBe('full')
  })

  it('gives a long thin chain a tier but almost no room to use it', () => {
    // 30 hexes in a straight line: a big empire with nowhere to put a big mark. The tier is only
    // permission to try — what actually protects the layout is the measured box below, which on a
    // one-tile-wide chain is barely taller than a single hex however long the chain runs.
    const chain = Array.from({ length: 30 }, (_, q) => ({ q, r: 0 }))
    const footprint = computeClusterFootprint(chain)
    expect(footprint.depth).toBe(1)

    const bounds = clusterWorldBounds(chain, HEX_SIZE)
    const box = inscribedContentBox(chain, axialToPixel(origin, HEX_SIZE), bounds, HEX_SIZE)
    expect(box.halfHeight).toBeLessThan(HEX_SIZE)
    // Wide, though: a chain has length even when it has no thickness.
    expect(box.halfWidth).toBeGreaterThan(box.halfHeight)
  })

  it('keeps the band where text renders on owned ground', () => {
    // An L: the corner is owned, the notch is not. The box is allowed to overhang at the corners —
    // a hex tiling contains almost no axis-aligned rectangle, and insisting on one starved a solid
    // five-tile block down to under a hex. What must hold is the centre band, because lines of
    // text are centred both ways and that is where every glyph actually lands.
    const shape = [origin, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 0, r: 1 }, { q: 0, r: 2 }]
    const bounds = clusterWorldBounds(shape, HEX_SIZE)
    const centre = axialToPixel(origin, HEX_SIZE)
    const box = inscribedContentBox(shape, centre, bounds, HEX_SIZE)

    const members = new Set(shape.map(axialKey))
    for (const fx of [-0.8, -0.4, 0, 0.4, 0.8]) {
      for (const fz of [-0.5, 0, 0.5]) {
        const probe = { x: centre.x + fx * box.halfWidth, z: centre.z + fz * box.halfHeight }
        expect(members.has(axialKey(pixelToHex(probe, HEX_SIZE)))).toBe(true)
      }
    }
  })

  it('grows the text box with the territory', () => {
    const boxFor = (cluster: AxialCoord[]) => {
      const fp = computeClusterFootprint(cluster)
      const bounds = clusterWorldBounds(cluster, HEX_SIZE)
      return inscribedContentBox(cluster, axialToPixel(fp.anchor, HEX_SIZE), bounds, HEX_SIZE)
    }
    const one = boxFor([origin])
    const seven = boxFor(hexesInRadius(origin, 1))
    const nineteen = boxFor(hexesInRadius(origin, 2))

    // More ground bought means more room to say something, which is the product promise.
    expect(seven.halfWidth).toBeGreaterThan(one.halfWidth)
    expect(nineteen.halfWidth).toBeGreaterThan(seven.halfWidth)
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

