import { describe, expect, it } from 'vitest'
import { focusForCluster } from './clusterFootprint'
import { clusterWorldBounds } from './hexGeometry'
import { hexesInRadius } from './bulkClusters'
import { axialToPixel, axialKey, type AxialCoord } from './hexMath'
import { HEX_SIZE } from './mapConfig'

const origin: AxialCoord = { q: 0, r: 0 }

/** Convenience: run focusForCluster against a cluster's own bounds. */
function focusOf(cluster: AxialCoord[]) {
  return focusForCluster(cluster, clusterWorldBounds(cluster, HEX_SIZE))
}

/** Converts a focus point back to world space, so placement can be checked against tile centres. */
function focusWorld(cluster: AxialCoord[]) {
  const bounds = clusterWorldBounds(cluster, HEX_SIZE)
  const { focus } = focusForCluster(cluster, bounds)
  return {
    x: bounds.minX + focus.u * (bounds.maxX - bounds.minX),
    z: bounds.minZ + (1 - focus.v) * (bounds.maxZ - bounds.minZ),
    radius: focus.halfU * (bounds.maxX - bounds.minX),
  }
}

describe('focusForCluster', () => {
  it('centres a single hex on that hex', () => {
    const { x, z } = focusWorld([origin])
    expect(x).toBeCloseTo(0, 6)
    expect(z).toBeCloseTo(0, 6)
  })

  it('keeps a single hex mark small enough to fit its own tile', () => {
    // A lone tile measures sqrt(3) across the flats; a larger mark would just be clipped away.
    expect(focusWorld([origin]).radius).toBeLessThanOrEqual((Math.sqrt(3) / 2) * HEX_SIZE + 1e-6)
  })

  it('lands BETWEEN tiles for a two-tile claim, not on either one', () => {
    // The behaviour the whole change is about: the mark belongs on the seam, so it reads as one
    // image across the block rather than a sticker on one hex.
    const pair: AxialCoord[] = [origin, { q: 1, r: 0 }]
    const { x } = focusWorld(pair)
    const centres = pair.map((coord) => axialToPixel(coord, HEX_SIZE))
    expect(x).toBeGreaterThan(Math.min(...centres.map((c) => c.x)) + 0.1)
    expect(x).toBeLessThan(Math.max(...centres.map((c) => c.x)) - 0.1)
  })

  it('sizes a compact blob to span more than one tile', () => {
    // The reported bug: a four-tile blob rendered a mark under one hex wide, jammed in a corner.
    const blob: AxialCoord[] = [origin, { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: 1 }]
    expect(focusWorld(blob).radius).toBeGreaterThan((Math.sqrt(3) / 2) * HEX_SIZE)
  })

  it('grows the mark as the territory grows', () => {
    const small = focusWorld(hexesInRadius(origin, 1)).radius
    const large = focusWorld(hexesInRadius(origin, 3)).radius
    expect(large).toBeGreaterThan(small)
  })

  it('keeps the anchor on owned ground for a ring, not in its hollow', () => {
    // The mean of a ring is its empty centre, which belongs to somebody else. Placing the mark
    // there would paint it onto a rival's tile — or, since the mosaic only covers owned tiles,
    // paint nothing at all.
    const ring = hexesInRadius(origin, 1).filter((coord) => !(coord.q === 0 && coord.r === 0))
    const { x, z } = focusWorld(ring)
    const distanceToNearestTile = Math.min(
      ...ring.map((coord) => {
        const centre = axialToPixel(coord, HEX_SIZE)
        return Math.hypot(centre.x - x, centre.z - z)
      }),
    )
    expect(distanceToNearestTile).toBeLessThanOrEqual(HEX_SIZE)
  })

  it('stays inside 0..1 texture space for every shape', () => {
    const shapes: AxialCoord[][] = [
      [origin],
      [origin, { q: 1, r: 0 }],
      hexesInRadius(origin, 2),
      Array.from({ length: 12 }, (_, q) => ({ q, r: 0 })),
      [origin, { q: 5, r: 5 }, { q: -5, r: 2 }],
    ]
    for (const shape of shapes) {
      const { focus } = focusOf(shape)
      expect(focus.u).toBeGreaterThanOrEqual(0)
      expect(focus.u).toBeLessThanOrEqual(1)
      expect(focus.v).toBeGreaterThanOrEqual(0)
      expect(focus.v).toBeLessThanOrEqual(1)
      expect(focus.halfU).toBeGreaterThan(0)
      expect(focus.halfV).toBeGreaterThan(0)
    }
  })

  it('reports a richer detail tier as the territory gets bigger', () => {
    expect(focusOf([origin]).detail).toBe('compact')
    expect(focusOf([origin, { q: 1, r: 0 }]).detail).toBe('standard')
    expect(focusOf(hexesInRadius(origin, 1)).detail).toBe('full')
    expect(focusOf(hexesInRadius(origin, 2)).detail).toBe('full')
  })

  it('keeps the text box inside the mark box', () => {
    // Words are confined to measured ground; the mark may use the generous estimate and be cropped
    // at a tile edge, which looks intentional in a way a cut-off sentence never does.
    for (const cluster of [[origin], hexesInRadius(origin, 1), hexesInRadius(origin, 2)]) {
      const { focus } = focusForCluster(cluster, clusterWorldBounds(cluster, HEX_SIZE))
      expect(focus.textHalfU).toBeLessThanOrEqual(focus.halfU)
      expect(focus.textHalfV).toBeLessThanOrEqual(focus.halfV)
      expect(focus.textHalfU).toBeGreaterThan(0)
      expect(focus.textHalfV).toBeGreaterThan(0)
    }
  })

  it('does not blow up on a long thin chain', () => {
    // A one-tile-wide chain genuinely has nowhere to put a large mark; it must stay modest rather
    // than scaling to the chain's length.
    const chain = Array.from({ length: 20 }, (_, q) => ({ q, r: 0 }))
    const { radius } = focusWorld(chain)
    expect(radius).toBeLessThan(2 * HEX_SIZE)
    expect(Number.isFinite(radius)).toBe(true)
  })

  it('produces the same placement however the tiles were ordered', () => {
    const shape: AxialCoord[] = [origin, { q: 1, r: 0 }, { q: 1, r: -1 }]
    const forward = focusOf(shape)
    const reversed = focusOf([...shape].reverse())
    expect(forward.focus.u).toBeCloseTo(reversed.focus.u, 10)
    expect(forward.focus.v).toBeCloseTo(reversed.focus.v, 10)
    expect(axialKey(forward.detail === reversed.detail ? origin : origin)).toBe('0,0')
  })
})
