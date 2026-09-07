import { axialKey, hexNeighbors, type AxialCoord } from './hexMath'

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
    return { anchor: first, depth: 1, detail: detailForDepth(1) }
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

  return { anchor, depth: maxDepth, detail: detailForDepth(maxDepth) }
}

function detailForDepth(depth: number): PlaqueDetail {
  // Every tier carries the logo *and* the domain: a tile has to say who owns it without being
  // hovered, and a bare mark doesn't do that for a company nobody recognizes by its icon. What
  // scales is how much room each element gets, and whether there's space for the scraped title
  // on top — at one hex wide it would render a couple of pixels tall and read as noise.
  if (depth <= 1) return 'compact'
  if (depth === 2) return 'standard'
  return 'full'
}

/**
 * Side length, in world units, of the square plaque a footprint of this depth can carry.
 *
 * A flat-top hex of side `s` has apothem `s * sqrt(3) / 2` — the radius of its *inscribed* circle,
 * which is the measurement that matters here, since the plaque has to stay inside the tile rather
 * than reach its corners. `depth` rings of clearance around the anchor gives a combined apothem of
 * `sqrt(3) * (depth - 0.5) * s`, and the square plaque spans twice that, less a margin so it never
 * quite touches the cluster's outer edge.
 */
export function plaqueSideForDepth(depth: number, hexSize: number): number {
  return 2 * Math.sqrt(3) * (depth - 0.5) * hexSize * 0.9
}
