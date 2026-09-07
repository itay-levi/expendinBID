import { SQRT3, type AxialCoord } from './hexMath'

export type WorldRect = { minX: number; maxX: number; minZ: number; maxZ: number }

/**
 * Hard ceiling on how many hexes one frame will generate.
 *
 * The map is unbounded, so "how many tiles are on screen" is a function of zoom with no natural
 * limit — a camera zoomed far enough out would otherwise ask for millions of instances and hang
 * the tab. Beyond this the field is clamped (see `hexesInWorldRect`), which is invisible in
 * practice because MapControls' `minZoom` keeps the visible count far below it.
 */
export const MAX_VISIBLE_HEXES = 6_000

/**
 * Every hex whose center falls inside a world-space rectangle, for a flat-top layout.
 *
 * This is what lets the grid be infinite without paying for it: rather than generating a fixed
 * radius of tiles up front and hoping nobody reaches the edge, the renderer asks only for the
 * tiles the camera can actually see, and generates them on the fly as it pans. Cost tracks screen
 * area, not map size, so panning to q=100000 costs exactly what the origin costs.
 *
 * Inverts `axialToPixel` analytically instead of scanning a candidate grid — `x = 1.5*size*q`
 * gives the q range directly, and each q column's r range follows from
 * `z = size * (SQRT3/2 * q + SQRT3 * r)`.
 */
export function hexesInWorldRect(rect: WorldRect, size: number, maxHexes: number = MAX_VISIBLE_HEXES): AxialCoord[] {
  if (size <= 0) return []
  if (!Number.isFinite(rect.minX) || !Number.isFinite(rect.maxX)) return []
  if (!Number.isFinite(rect.minZ) || !Number.isFinite(rect.maxZ)) return []
  if (rect.maxX < rect.minX || rect.maxZ < rect.minZ) return []

  const columnWidth = 1.5 * size
  const rowHeight = SQRT3 * size

  // One extra column/row of margin on each side so hexes whose center is just outside the rect,
  // but whose body overlaps it, are still drawn — otherwise tiles visibly pop in at the edges.
  const qMin = Math.floor(rect.minX / columnWidth) - 1
  const qMax = Math.ceil(rect.maxX / columnWidth) + 1

  const coords: AxialCoord[] = []

  for (let q = qMin; q <= qMax; q += 1) {
    const rOffset = q / 2
    const rMin = Math.floor(rect.minZ / rowHeight - rOffset) - 1
    const rMax = Math.ceil(rect.maxZ / rowHeight - rOffset) + 1

    for (let r = rMin; r <= rMax; r += 1) {
      if (coords.length >= maxHexes) return coords
      coords.push({ q, r })
    }
  }

  return coords
}

/**
 * The world-space rectangle an orthographic camera sees, expanded by `padding` world units.
 *
 * Only valid for a camera looking at the XZ ground plane, which this scene's locked isometric
 * camera always is (MapControls has rotation disabled). The vertical half-extent is divided by
 * the tilt's cosine because the ground plane is viewed at an angle, so a given screen height
 * covers proportionally more ground than it does width.
 */
export function orthographicGroundRect(
  center: { x: number; z: number },
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
  tiltRadians: number,
  padding: number,
): WorldRect {
  if (zoom <= 0 || !Number.isFinite(zoom)) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }

  const halfWidth = viewportWidth / (2 * zoom) + padding
  // Guarded against a degenerate 90deg tilt (a top-down camera), where cos is 0 and this diverges.
  const tiltFactor = Math.max(Math.cos(tiltRadians), 0.05)
  const halfDepth = viewportHeight / (2 * zoom * tiltFactor) + padding

  return {
    minX: center.x - halfWidth,
    maxX: center.x + halfWidth,
    minZ: center.z - halfDepth,
    maxZ: center.z + halfDepth,
  }
}
