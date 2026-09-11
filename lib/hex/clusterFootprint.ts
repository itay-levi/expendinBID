import { axialKey, axialToPixel, hexNeighbors, pixelToHex, type AxialCoord, type PixelCoord } from './hexMath'
import { HEX_SIZE } from './mapConfig'
import type { ClusterBounds } from './hexGeometry'

/**
 * How much of a brand mark a cluster has room to show. Driven by the cluster's *inscribed* size,
 * not its hex count: a 30-hex chain one tile wide has no more room for text than a single hex
 * does, however impressive its total holdings are.
 */
export type PlaqueDetail = 'compact' | 'standard' | 'full'

export type ClusterFootprint = {
  /** The most interior hex — the plaque's anchor, guaranteed to sit on the empire's own ground. */
  anchor: AxialCoord
  /** Distance in hex rings from `anchor` to the nearest edge of the cluster. Always >= 1. */
  depth: number
  detail: PlaqueDetail
}

/**
 * Finds where an empire's logo should sit within one contiguous cluster, and how big it can be.
 *
 * The naive approach — center the plaque on the mean of the cluster's hexes and size it by the
 * distance to the farthest one — breaks on exactly the shapes real territory takes. The mean of a
 * C-shaped or two-lobed cluster lands in the hollow, on someone else's tiles; and sizing by the
 * farthest hex makes a long thin chain request a plaque far wider than the chain itself, so the
 * logo spills across neighbouring empires.
 *
 * Instead this erodes the cluster from its boundary inward (a multi-source BFS). The hex that
 * survives longest is the most interior one, and the number of rounds it survived is precisely how
 * many hex rings of clearance the plaque has in every direction. That single number answers both
 * questions: where to put the mark, and how large it is allowed to be.
 */
export function computeClusterFootprint(cluster: AxialCoord[]): ClusterFootprint {
  const first = cluster[0]
  if (!first) throw new Error('computeClusterFootprint requires a non-empty cluster')

  const members = new Set(cluster.map(axialKey))
  const depthByKey = new Map<string, number>()
  const queue: AxialCoord[] = []

  // Seed: every hex touching the outside world is one ring deep.
  for (const coord of cluster) {
    if (hexNeighbors(coord).some((n) => !members.has(axialKey(n)))) {
      depthByKey.set(axialKey(coord), 1)
      queue.push(coord)
    }
  }

  // A cluster with no boundary at all can't occur on a finite map (edge hexes always border the
  // void), but treating it as uniformly shallow keeps this total rather than returning undefined.
  if (queue.length === 0) {
    return { anchor: first, depth: 1, detail: detailForCluster(cluster.length) }
  }

  let anchor = queue[0]!
  let maxDepth = 1

  for (let head = 0; head < queue.length; head += 1) {
    const coord = queue[head]!
    const depth = depthByKey.get(axialKey(coord))!

    if (depth > maxDepth) {
      maxDepth = depth
      anchor = coord
    }

    for (const neighbor of hexNeighbors(coord)) {
      const key = axialKey(neighbor)
      if (!members.has(key) || depthByKey.has(key)) continue
      depthByKey.set(key, depth + 1)
      queue.push(neighbor)
    }
  }

  return { anchor, depth: maxDepth, detail: detailForCluster(cluster.length) }
}

/** Tiles a cluster needs before the domain, and then the description, earn their place. */
const STANDARD_MIN_TILES = 2
const FULL_MIN_TILES = 4

function detailForCluster(tileCount: number): PlaqueDetail {
  // Driven purely by how much ground there is.
  //
  // Gating on depth alone was the bug: erosion depth reaches 2 only when some tile is completely
  // enclosed, which takes seven hexes, and 3 at nineteen. So a buyer holding a solid block of four
  // or five tiles — visibly substantial, and paying an escalating price for it — got a bare logo
  // with no name and no description at all, while the tier that shows a sentence was unreachable
  // below nineteen tiles.
  //
  // Shape deliberately plays no part here, because depth cannot see it: a five-tile blob and a
  // five-tile line both erode to depth 1. A tier is only permission to try — `inscribedContentBox`
  // measures the room that actually exists, and the renderer drops any line that cannot reach a
  // legible size in it. A thin chain is therefore held back by measurement, not by a guess.
  if (tileCount < STANDARD_MIN_TILES) return 'compact'
  if (tileCount < FULL_MIN_TILES) return 'standard'
  return 'full'
}


/**
 * Where a cluster's mark should sit inside its bounding box, in 0..1 texture space.
 *
 * Two things this gets right that the obvious approaches do not.
 *
 * **It centres on the territory, not on a tile.** The anchor is the mean of the tile centres, which
 * for anything larger than a single hex lands on a *seam between* tiles rather than in the middle
 * of one. That is what makes the mark read as one image painted across the block instead of a
 * sticker stuck on one hex.
 *
 * **It is sized to span several tiles.** An earlier version sized content to the clearance of the
 * single most-interior tile, which on a compact four-tile blob — where every tile touches the
 * outside — is under one hex across, so the logo came out tiny and shoved into a corner. That was
 * guarding against a problem that does not exist: the mosaic mesh only covers tiles the empire
 * owns, so a mark drawn larger than the territory is simply not painted past its edge. It cannot
 * bleed onto a rival's ground.
 *
 * The size is the larger of the inscribed clearance and a share of the cluster's smaller dimension,
 * so a fat blob gets a big mark, a single hex gets one that fits it, and a one-tile-wide chain gets
 * a modest one — which is correct, since a thin chain genuinely has nowhere to put a large logo.
 */
export function focusForCluster(cluster: AxialCoord[], bounds: ClusterBounds) {
  const footprint = computeClusterFootprint(cluster)
  const width = bounds.maxX - bounds.minX
  const depth = bounds.maxZ - bounds.minZ

  const centres = cluster.map((coord) => axialToPixel(coord, HEX_SIZE))
  const mean = centres.reduce(
    (acc, point) => ({ x: acc.x + point.x / centres.length, z: acc.z + point.z / centres.length }),
    { x: 0, z: 0 },
  )

  // A ring or a C-shape has its mean in the hollow, which belongs to somebody else. Fall back to
  // the eroded interior tile whenever the mean is not sitting on ground this empire actually holds.
  const nearestOwned = centres.reduce(
    (best, point) => {
      const distance = Math.hypot(point.x - mean.x, point.z - mean.z)
      return distance < best.distance ? { point, distance } : best
    },
    { point: centres[0] as { x: number; z: number }, distance: Infinity },
  )
  const meanIsOnOwnedGround = nearestOwned.distance <= HEX_SIZE
  const anchor = meanIsOnOwnedGround ? mean : axialToPixel(footprint.anchor, HEX_SIZE)

  // How big the mark can be: driven by how much ground there is, capped by how thick that ground
  // actually is.
  //
  // The area term (sqrt of tile count) is what lets a compact blob carry a mark spanning several
  // tiles rather than one. The clearance cap is what stops a long chain from doing the same — and
  // the cap has to come from the erosion depth, NOT the bounding box: a chain running diagonally
  // spans a large box on *both* axes while being one tile wide, and sizing off that box gave it a
  // mark eight world units across on ground that could hold one.
  const apothem = (Math.sqrt(3) / 2) * HEX_SIZE
  const areaRadius = Math.sqrt(cluster.length) * apothem
  const clearanceCap = footprint.depth * Math.sqrt(3) * HEX_SIZE
  const safeRadius = Math.min(areaRadius, clearanceCap)

  // Words get a box measured against the territory rather than estimated from it. The mark keeps
  // the generous one: cropping a logo at a tile edge looks intentional, cropping a sentence does
  // not. See `inscribedContentBox`.
  const textBox = inscribedContentBox(cluster, anchor, bounds, HEX_SIZE)

  return {
    detail: footprint.detail,
    focus: {
      u: width > 0 ? (anchor.x - bounds.minX) / width : 0.5,
      // Inverted to match the mosaic's own UV flip (THREE.CanvasTexture uploads with flipY on).
      v: depth > 0 ? 1 - (anchor.z - bounds.minZ) / depth : 0.5,
      halfU: width > 0 ? safeRadius / width : 0.5,
      halfV: depth > 0 ? safeRadius / depth : 0.5,
      // Same centre, but only as far as owned ground actually reaches.
      textHalfU: width > 0 ? Math.min(textBox.halfWidth, safeRadius) / width : 0.5,
      textHalfV: depth > 0 ? Math.min(textBox.halfHeight, safeRadius) / depth : 0.5,
    },
  }
}

/** Grid resolution used to test whether a candidate box lies on owned ground. */
const COVERAGE_SAMPLES = 8
/** Centre-weighted share of a box that must sit on owned tiles for it to be usable for text. */
const MIN_OWNED_COVERAGE = 0.9
/** Halvings of the search interval. 12 puts the answer within ~0.02% of the true largest box. */
const FIT_ITERATIONS = 12

/**
 * The largest axis-aligned box centred on `center` that lands only on tiles this cluster owns.
 *
 * Words need this; the logo does not. The mosaic paints owned tiles and nothing else, so anything
 * drawn past the territory's edge is simply cut away. On a mark that reads as deliberate cropping.
 * On a sentence it reads as a defect — "Territory on Hex Wars, controlled by see.i" — which is
 * what a buyer paying for the space actually sees. Fitting the text inside verified ground is what
 * keeps the sentence whole, and it is measured rather than assumed because territory is any shape:
 * an L, a ring, a crescent. The erosion depth alone can only certify a single hex for most real
 * clusters, which would shrink a five-tile block's text to nothing.
 *
 * Returns half-extents in world units. Never returns zero: the fallback is one hex's inscribed
 * circle, which is owned by construction whenever `center` sits on a tile.
 */
export function inscribedContentBox(
  cluster: AxialCoord[],
  center: PixelCoord,
  bounds: ClusterBounds,
  hexSize: number,
): { halfWidth: number; halfHeight: number } {
  const members = new Set(cluster.map(axialKey))

  // Demanding every sample land on owned ground sounds right and is far too strict: a hex tiling
  // contains almost no axis-aligned rectangle, so a solid five-tile block measured out at under
  // one hex across — starving the very case this was meant to serve. A rectangle is accepted when
  // nearly all of it is owned, and the corners are what it is allowed to give up: text is centred
  // both ways, so the middle band is where the words actually are.
  const covers = (halfWidth: number, halfHeight: number): boolean => {
    let inside = 0
    let total = 0
    for (let i = 0; i <= COVERAGE_SAMPLES; i += 1) {
      const u = -1 + (2 * i) / COVERAGE_SAMPLES
      const x = center.x + u * halfWidth
      for (let j = 0; j <= COVERAGE_SAMPLES; j += 1) {
        const v = -1 + (2 * j) / COVERAGE_SAMPLES
        // Weight toward the middle: a missing corner costs little, a hole under the text costs
        // the sentence.
        const weight = 1 + 2 * (1 - Math.max(Math.abs(u), Math.abs(v)))
        total += weight
        const z = center.z + v * halfHeight
        if (members.has(axialKey(pixelToHex({ x, z }, hexSize)))) inside += weight
      }
    }
    return total > 0 && inside / total >= MIN_OWNED_COVERAGE
  }

  // Search along the territory's own proportions, so a wide empire gets a wide box rather than a
  // square one cropped to its narrowest axis.
  const reachX = Math.max(bounds.maxX - center.x, center.x - bounds.minX)
  const reachZ = Math.max(bounds.maxZ - center.z, center.z - bounds.minZ)

  let low = 0
  let high = 1
  for (let step = 0; step < FIT_ITERATIONS; step += 1) {
    const mid = (low + high) / 2
    if (covers(reachX * mid, reachZ * mid)) low = mid
    else high = mid
  }

  const apothem = (Math.sqrt(3) / 2) * hexSize
  return {
    halfWidth: Math.max(reachX * low, apothem * 0.7),
    halfHeight: Math.max(reachZ * low, apothem * 0.7),
  }
}
