import { HEX_DIRECTIONS, axialKey, axialToPixel, type AxialCoord, type PixelCoord } from './hexMath'

/**
 * The 6 corners of a flat-top hex, in world XZ, relative to its center.
 *
 * Corner `i` sits at `60deg * i`, which is the convention `axialToPixel` is built around: the +q
 * neighbor lies due east at `1.5 * size`, so the hex must be point-east / flat-north.
 */
export function hexCornerXZ(size: number, index: number): PixelCoord {
  const angle = (Math.PI / 3) * index
  return { x: size * Math.cos(angle), z: size * Math.sin(angle) }
}

/**
 * Which of the 6 edges faces the neighbor in `HEX_DIRECTIONS[directionIndex]`.
 *
 * Edge `i` spans corner `i` to corner `i + 1`, so its outward normal points at `60deg*i + 30deg`.
 * Rather than hard-coding a lookup table that silently rots if `HEX_DIRECTIONS` is ever reordered,
 * this derives the mapping from the direction's actual world offset.
 */
export function edgeIndexForDirection(directionIndex: number): number {
  const direction = HEX_DIRECTIONS[directionIndex]
  if (!direction) throw new Error(`No hex direction at index ${directionIndex}`)
  const offset = axialToPixel(direction, 1)
  const angle = Math.atan2(offset.z, offset.x)
  // Undo the 30deg normal offset, then snap to the nearest sixth of a turn.
  const index = Math.round((angle - Math.PI / 6) / (Math.PI / 3))
  return ((index % 6) + 6) % 6
}

export type BoundaryEdge = { coord: AxialCoord; edgeIndex: number }

/**
 * The outer perimeter of a set of hexes: every edge that faces something outside the set.
 *
 * This is what makes a multi-hex selection read as one territory rather than a scattering of
 * separately outlined tiles — the shared edges between selected hexes are omitted, so a connected
 * group is drawn with a single unbroken border. A lone hex has no selected neighbors, so all six
 * of its edges qualify and the same function draws the plain ring used for hover highlighting.
 */
export function regionBoundaryEdges(coords: AxialCoord[]): BoundaryEdge[] {
  const members = new Set(coords.map(axialKey))
  const edges: BoundaryEdge[] = []

  for (const coord of coords) {
    HEX_DIRECTIONS.forEach((direction, directionIndex) => {
      const neighborKey = axialKey({ q: coord.q + direction.q, r: coord.r + direction.r })
      if (members.has(neighborKey)) return
      edges.push({ coord, edgeIndex: edgeIndexForDirection(directionIndex) })
    })
  }

  return edges
}

/**
 * Triangulates boundary edges into a flat ribbon lying in the XZ plane at y = `elevation`.
 *
 * A ribbon of real triangles rather than `THREE.Line`: WebGL ignores `linewidth` on virtually every
 * platform, so a line-based outline is stuck at one hairline pixel and all but vanishes when the
 * map is zoomed out — useless for the one thing it exists to communicate.
 *
 * Returns a flat Float32Array of triangle vertices, ready for a non-indexed BufferGeometry.
 */
export function buildEdgeRibbonVertices(
  edges: BoundaryEdge[],
  size: number,
  thickness: number,
  elevation: number,
): Float32Array {
  const vertices = new Float32Array(edges.length * 18) // 2 triangles * 3 vertices * 3 components
  let offset = 0

  // Clamped so an over-large thickness collapses the ribbon to the hex center instead of turning
  // it inside out into a self-intersecting star.
  const innerSize = Math.max(0, size - thickness)

  for (const { coord, edgeIndex } of edges) {
    const center = axialToPixel(coord, size)
    const outerA = hexCornerXZ(size, edgeIndex)
    const outerB = hexCornerXZ(size, edgeIndex + 1)
    const innerA = hexCornerXZ(innerSize, edgeIndex)
    const innerB = hexCornerXZ(innerSize, edgeIndex + 1)

    const triangles = [
      [outerA, outerB, innerB],
      [outerA, innerB, innerA],
    ] as const

    for (const triangle of triangles) {
      for (const point of triangle) {
        vertices[offset] = center.x + point.x
        vertices[offset + 1] = elevation
        vertices[offset + 2] = center.z + point.z
        offset += 3
      }
    }
  }

  return vertices
}

export type ClusterBounds = { minX: number; maxX: number; minZ: number; maxZ: number }

/** World-space bounding box of a set of hexes, including their corners rather than just centers. */
export function clusterWorldBounds(coords: AxialCoord[], size: number): ClusterBounds {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  for (const coord of coords) {
    const center = axialToPixel(coord, size)
    // Every hex extends `size` horizontally and `size * sqrt(3)/2` vertically from its center;
    // using centers alone would crop the outermost tiles out of the projection.
    minX = Math.min(minX, center.x - size)
    maxX = Math.max(maxX, center.x + size)
    minZ = Math.min(minZ, center.z - (size * Math.sqrt(3)) / 2)
    maxZ = Math.max(maxZ, center.z + (size * Math.sqrt(3)) / 2)
  }

  if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }
  return { minX, maxX, minZ, maxZ }
}

/**
 * Builds one flat mesh covering a cluster's hexes, UV-mapped so a single image spans the whole
 * territory.
 *
 * This is what makes an empire's mark scale with its holdings instead of sitting on one tile. Each
 * hex is a triangle fan, and its UVs come from where it sits inside the cluster's bounding box —
 * so every tile displays its own slice of one large logo, and twenty hexes show that logo twenty
 * hexes wide. The tiles underneath stay visible through the gaps between hexes, so the grid still
 * reads as a grid rather than being papered over by a flat plane.
 *
 * `v` is inverted because `THREE.CanvasTexture` uploads with `flipY` on by default: without the
 * flip, the image would render upside down across the territory.
 */
export function buildClusterMosaicGeometry(
  coords: AxialCoord[],
  size: number,
  elevation: number,
  bounds: ClusterBounds,
): { positions: Float32Array; uvs: Float32Array } {
  const width = bounds.maxX - bounds.minX
  const depth = bounds.maxZ - bounds.minZ

  // 6 triangles per hex, 3 vertices each.
  const positions = new Float32Array(coords.length * 6 * 3 * 3)
  const uvs = new Float32Array(coords.length * 6 * 3 * 2)
  let p = 0
  let t = 0

  const uvAt = (x: number, z: number): [number, number] => [
    width > 0 ? (x - bounds.minX) / width : 0.5,
    depth > 0 ? 1 - (z - bounds.minZ) / depth : 0.5,
  ]

  for (const coord of coords) {
    const center = axialToPixel(coord, size)

    for (let i = 0; i < 6; i += 1) {
      const a = hexCornerXZ(size, i)
      const b = hexCornerXZ(size, i + 1)
      // Wound center -> b -> a, NOT center -> a -> b. Corner angle increases counter-clockwise in
      // the XZ plane, and in a right-handed Y-up system that ordering produces a face normal
      // pointing DOWN — so every triangle is back-face culled and the whole mosaic renders as
      // nothing at all while looking perfectly correct in the data.
      const triangle: Array<[number, number]> = [
        [center.x, center.z],
        [center.x + b.x, center.z + b.z],
        [center.x + a.x, center.z + a.z],
      ]

      for (const [x, z] of triangle) {
        positions[p] = x
        positions[p + 1] = elevation
        positions[p + 2] = z
        p += 3

        const [u, v] = uvAt(x, z)
        uvs[t] = u
        uvs[t + 1] = v
        t += 2
      }
    }
  }

  return { positions, uvs }
}
