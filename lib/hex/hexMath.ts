// Flat-top hexagon grid, axial + cube coordinates.
// Reference derivation: https://www.redblobgames.com/grids/hexagons/ (axial/cube math is standard; this file is a from-scratch TS port, not copied code).

export type AxialCoord = { q: number; r: number }
export type CubeCoord = { x: number; y: number; z: number }
export type PixelCoord = { x: number; z: number } // z instead of y: these map directly onto the Three.js ground plane (x, z), leaving y free for elevation.

/** Exported so layout inverses (lib/hex/viewport.ts) derive from the same constant this file lays out with. */
export const SQRT3 = Math.sqrt(3)

/** The 6 axial direction vectors, in clockwise order starting from the flat-top hex's east neighbor. */
export const HEX_DIRECTIONS: AxialCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

export function axialToCube(hex: AxialCoord): CubeCoord {
  const x = hex.q
  const z = hex.r
  const y = -x - z
  return { x, y, z }
}

export function cubeToAxial(cube: CubeCoord): AxialCoord {
  return { q: cube.x, r: cube.z }
}

export function axialKey(hex: AxialCoord): string {
  return `${hex.q},${hex.r}`
}

/**
 * Flat-top axial -> world position. `size` is the hex's circumradius (center to corner)
 * in world units; this is the single knob that controls grid scale.
 */
export function axialToPixel(hex: AxialCoord, size: number): PixelCoord {
  const x = size * (1.5 * hex.q)
  const z = size * (SQRT3 * 0.5 * hex.q + SQRT3 * hex.r)
  return { x, z }
}

/** Inverse of axialToPixel — returns fractional cube coords, must be passed through hexRound(). */
function pixelToFractionalCube(point: PixelCoord, size: number): CubeCoord {
  const q = (2 / 3) * (point.x / size)
  const r = ((-1 / 3) * (point.x / size)) + ((SQRT3 / 3) * (point.z / size))
  const x = q
  const z = r
  const y = -x - z
  return { x, y, z }
}

/**
 * Rounds fractional cube coordinates to the nearest valid hex. Naive per-axis rounding can
 * violate x+y+z=0, so the axis with the largest rounding error is recomputed from the other two.
 */
export function hexRound(cube: CubeCoord): CubeCoord {
  let rx = Math.round(cube.x)
  let ry = Math.round(cube.y)
  let rz = Math.round(cube.z)

  const xDiff = Math.abs(rx - cube.x)
  const yDiff = Math.abs(ry - cube.y)
  const zDiff = Math.abs(rz - cube.z)

  if (xDiff > yDiff && xDiff > zDiff) {
    rx = -ry - rz
  } else if (yDiff > zDiff) {
    ry = -rx - rz
  } else {
    rz = -rx - ry
  }

  return { x: rx, y: ry, z: rz }
}

/** Converts a world-space point (e.g. a raycast hit on the ground plane) to the nearest hex. */
export function pixelToHex(point: PixelCoord, size: number): AxialCoord {
  return cubeToAxial(hexRound(pixelToFractionalCube(point, size)))
}

/** The 6 corner points of a flat-top hex centered at `center`, for custom geometry/outline meshes. */
export function hexCorners(center: PixelCoord, size: number): PixelCoord[] {
  const corners: PixelCoord[] = []
  for (let i = 0; i < 6; i++) {
    const angleDeg = 60 * i
    const angleRad = (Math.PI / 180) * angleDeg
    corners.push({
      x: center.x + size * Math.cos(angleRad),
      z: center.z + size * Math.sin(angleRad),
    })
  }
  return corners
}

export function hexNeighbors(hex: AxialCoord): AxialCoord[] {
  return HEX_DIRECTIONS.map((dir) => ({ q: hex.q + dir.q, r: hex.r + dir.r }))
}

export function hexDistance(a: AxialCoord, b: AxialCoord): number {
  const ac = axialToCube(a)
  const bc = axialToCube(b)
  return Math.max(Math.abs(ac.x - bc.x), Math.abs(ac.y - bc.y), Math.abs(ac.z - bc.z))
}

export function hexEquals(a: AxialCoord, b: AxialCoord): boolean {
  return a.q === b.q && a.r === b.r
}

/** All hexes within `radius` rings of the origin — used once at map-init to seed the empty field. */
export function generateHexagonGrid(radius: number): AxialCoord[] {
  const hexes: AxialCoord[] = []
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius)
    const rMax = Math.min(radius, -q + radius)
    for (let r = rMin; r <= rMax; r++) {
      hexes.push({ q, r })
    }
  }
  return hexes
}

/**
 * Flood-fills outward from `origin` through same-owner neighbors, using `isSameOwner` as the
 * membership test. Used to find the contiguous cluster a single merged brand logo should cover.
 */
export function floodFillCluster(
  origin: AxialCoord,
  isSameOwner: (hex: AxialCoord) => boolean,
): AxialCoord[] {
  const visited = new Set<string>([axialKey(origin)])
  const cluster: AxialCoord[] = [origin]
  const queue: AxialCoord[] = [origin]

  while (queue.length > 0) {
    const current = queue.shift() as AxialCoord
    for (const neighbor of hexNeighbors(current)) {
      const key = axialKey(neighbor)
      if (visited.has(key) || !isSameOwner(neighbor)) continue
      visited.add(key)
      cluster.push(neighbor)
      queue.push(neighbor)
    }
  }

  return cluster
}
