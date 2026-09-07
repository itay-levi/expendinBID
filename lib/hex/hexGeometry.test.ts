import { describe, expect, it } from 'vitest'
import {
  buildClusterMosaicGeometry,
  buildEdgeRibbonVertices,
  clusterWorldBounds,
  edgeIndexForDirection,
  hexCornerXZ,
  regionBoundaryEdges,
} from './hexGeometry'
import { HEX_DIRECTIONS, axialToPixel, type AxialCoord } from './hexMath'
import { hexesInRadius } from './bulkClusters'

const origin: AxialCoord = { q: 0, r: 0 }

describe('hexCornerXZ', () => {
  it('places corner 0 due east, matching the flat-top layout axialToPixel assumes', () => {
    const corner = hexCornerXZ(1, 0)
    expect(corner.x).toBeCloseTo(1, 10)
    expect(corner.z).toBeCloseTo(0, 10)
  })

  it('wraps around after six corners', () => {
    const first = hexCornerXZ(1, 0)
    const seventh = hexCornerXZ(1, 6)
    expect(seventh.x).toBeCloseTo(first.x, 10)
    expect(seventh.z).toBeCloseTo(first.z, 10)
  })

  it('produces corners exactly `size` from the center', () => {
    for (let i = 0; i < 6; i += 1) {
      const corner = hexCornerXZ(2.5, i)
      expect(Math.hypot(corner.x, corner.z)).toBeCloseTo(2.5, 10)
    }
  })
})

describe('edgeIndexForDirection', () => {
  it('gives each of the six directions its own distinct edge', () => {
    const indices = HEX_DIRECTIONS.map((_, i) => edgeIndexForDirection(i))
    expect(new Set(indices).size).toBe(6)
    expect([...indices].sort()).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('puts the edge midpoint exactly halfway to the neighbor it faces', () => {
    // The invariant that actually matters: an off-by-one mapping would draw every outline on the
    // wrong side of the hex, which looks plausible in isolation and wrong on a real cluster.
    HEX_DIRECTIONS.forEach((direction, directionIndex) => {
      const edgeIndex = edgeIndexForDirection(directionIndex)
      const a = hexCornerXZ(1, edgeIndex)
      const b = hexCornerXZ(1, edgeIndex + 1)
      const midpoint = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
      const neighborCenter = axialToPixel(direction, 1)
      expect(midpoint.x).toBeCloseTo(neighborCenter.x / 2, 10)
      expect(midpoint.z).toBeCloseTo(neighborCenter.z / 2, 10)
    })
  })
})

describe('regionBoundaryEdges', () => {
  it('outlines all six sides of a lone hex', () => {
    expect(regionBoundaryEdges([origin])).toHaveLength(6)
  })

  it('omits the shared edge between two adjacent hexes', () => {
    // 12 edges total, minus the two facing each other: a joined pair reads as one shape.
    expect(regionBoundaryEdges([origin, { q: 1, r: 0 }])).toHaveLength(10)
  })

  it('draws only the perimeter of a 7-hex cluster, never its interior', () => {
    // The center hex is fully enclosed so it contributes nothing; each of the 6 ring hexes faces
    // outward on 3 sides.
    const edges = regionBoundaryEdges(hexesInRadius(origin, 1))
    expect(edges).toHaveLength(18)
    expect(edges.some((edge) => edge.coord.q === 0 && edge.coord.r === 0)).toBe(false)
  })

  it('outlines two disconnected groups separately', () => {
    expect(regionBoundaryEdges([origin, { q: 5, r: 0 }])).toHaveLength(12)
  })

  it('returns nothing for an empty selection', () => {
    expect(regionBoundaryEdges([])).toEqual([])
  })
})

describe('buildEdgeRibbonVertices', () => {
  it('emits two triangles per edge', () => {
    const vertices = buildEdgeRibbonVertices(regionBoundaryEdges([origin]), 1, 0.1, 0.2)
    expect(vertices).toHaveLength(6 * 18)
  })

  it('keeps the whole ribbon flat at the requested elevation', () => {
    const vertices = buildEdgeRibbonVertices(regionBoundaryEdges([origin]), 1, 0.1, 0.42)
    // 6 places, not 10: these are Float32Array values, and float32 carries ~7 significant digits.
    for (let i = 1; i < vertices.length; i += 3) {
      expect(vertices[i]).toBeCloseTo(0.42, 6)
    }
  })

  it('offsets the ribbon onto the hex it belongs to, not the world origin', () => {
    const coord = { q: 3, r: -2 }
    const center = axialToPixel(coord, 1)
    const vertices = buildEdgeRibbonVertices(regionBoundaryEdges([coord]), 1, 0.1, 0)

    const xs: number[] = []
    for (let i = 0; i < vertices.length; i += 3) xs.push(vertices[i] as number)
    // Every vertex sits within one hex radius of that hex's own center.
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(center.x - 1.0001)
    expect(Math.max(...xs)).toBeLessThanOrEqual(center.x + 1.0001)
  })

  it('collapses rather than inverting when thickness exceeds the hex radius', () => {
    const vertices = buildEdgeRibbonVertices(regionBoundaryEdges([origin]), 1, 5, 0)
    expect(vertices.every((value) => Number.isFinite(value))).toBe(true)
  })
})

describe('clusterWorldBounds', () => {
  it('includes hex corners, not just centers', () => {
    const bounds = clusterWorldBounds([origin], 1)
    // A flat-top hex of size 1 spans 2 wide (corner to corner) and sqrt(3) deep (flat to flat).
    expect(bounds.maxX - bounds.minX).toBeCloseTo(2, 10)
    expect(bounds.maxZ - bounds.minZ).toBeCloseTo(Math.sqrt(3), 10)
  })

  it('grows to enclose a whole cluster', () => {
    const wide = clusterWorldBounds(hexesInRadius(origin, 2), 1)
    const single = clusterWorldBounds([origin], 1)
    expect(wide.maxX - wide.minX).toBeGreaterThan(single.maxX - single.minX)
    expect(wide.maxZ - wide.minZ).toBeGreaterThan(single.maxZ - single.minZ)
  })

  it('returns a degenerate box for no hexes rather than infinities', () => {
    expect(clusterWorldBounds([], 1)).toEqual({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 })
  })
})

describe('buildClusterMosaicGeometry', () => {
  const bounds = clusterWorldBounds(hexesInRadius(origin, 1), 1)

  it('emits six triangles per hex', () => {
    const { positions, uvs } = buildClusterMosaicGeometry(hexesInRadius(origin, 1), 1, 0.2, bounds)
    expect(positions).toHaveLength(7 * 6 * 3 * 3)
    expect(uvs).toHaveLength(7 * 6 * 3 * 2)
  })

  it('keeps every UV inside the 0..1 texture range', () => {
    // The whole point of the projection: no tile may sample outside the image, or the logo tiles
    // or clamps at the edges instead of spanning the territory once.
    const { uvs } = buildClusterMosaicGeometry(hexesInRadius(origin, 2), 1, 0.2, clusterWorldBounds(hexesInRadius(origin, 2), 1))
    for (const value of uvs) {
      expect(value).toBeGreaterThanOrEqual(-1e-6)
      expect(value).toBeLessThanOrEqual(1 + 1e-6)
    }
  })

  it('spans the full UV range across the cluster, so the image is used edge to edge', () => {
    const { uvs } = buildClusterMosaicGeometry(hexesInRadius(origin, 1), 1, 0.2, bounds)
    const us: number[] = []
    const vs: number[] = []
    for (let i = 0; i < uvs.length; i += 2) {
      us.push(uvs[i] as number)
      vs.push(uvs[i + 1] as number)
    }
    expect(Math.min(...us)).toBeCloseTo(0, 5)
    expect(Math.max(...us)).toBeCloseTo(1, 5)
    expect(Math.min(...vs)).toBeCloseTo(0, 5)
    expect(Math.max(...vs)).toBeCloseTo(1, 5)
  })

  it('gives a hex on the far side of the cluster a different slice than one on the near side', () => {
    // If both sampled the same region, every tile would show the same crop and there would be no
    // mosaic — just the logo repeated.
    const coords = [
      { q: 0, r: 0 },
      { q: 4, r: 0 },
    ]
    const { uvs } = buildClusterMosaicGeometry(coords, 1, 0.2, clusterWorldBounds(coords, 1))
    const firstHexU = uvs[0] as number
    const secondHexU = uvs[6 * 3 * 2] as number
    expect(Math.abs(firstHexU - secondHexU)).toBeGreaterThan(0.5)
  })

  it('keeps the whole mosaic flat at the requested elevation', () => {
    const { positions } = buildClusterMosaicGeometry([origin], 1, 0.42, clusterWorldBounds([origin], 1))
    for (let i = 1; i < positions.length; i += 3) {
      expect(positions[i]).toBeCloseTo(0.42, 6)
    }
  })

  it('centres the UV on a degenerate box instead of dividing by zero', () => {
    const { uvs } = buildClusterMosaicGeometry([origin], 1, 0, { minX: 0, maxX: 0, minZ: 0, maxZ: 0 })
    expect(uvs.every((value) => Number.isFinite(value))).toBe(true)
  })

  it('handles an empty cluster', () => {
    const { positions } = buildClusterMosaicGeometry([], 1, 0, bounds)
    expect(positions).toHaveLength(0)
  })
})

describe('buildClusterMosaicGeometry face orientation', () => {
  it('winds every triangle so its normal points UP', () => {
    // The bug this guards against renders as *nothing*: with the opposite winding every face
    // normal points at the ground, three.js back-face culls the lot, and the mosaic is invisible
    // while the vertex data still looks entirely correct.
    const coords = hexesInRadius(origin, 1)
    const { positions } = buildClusterMosaicGeometry(coords, 1, 0.2, clusterWorldBounds(coords, 1))

    for (let i = 0; i < positions.length; i += 9) {
      const ax = positions[i] as number
      const az = positions[i + 2] as number
      const bx = positions[i + 3] as number
      const bz = positions[i + 5] as number
      const cx = positions[i + 6] as number
      const cz = positions[i + 8] as number

      // y component of cross((b-a), (c-a)) for points in the XZ plane.
      const normalY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
      expect(normalY).toBeGreaterThan(0)
    }
  })
})
