import { axialKey, floodFillCluster, type AxialCoord } from './hexMath'
import type { HexTile } from '@/types/game'

export type OwnedCluster = {
  ownerId: string
  hexes: HexTile[]
}

/**
 * Partitions every owned hex into contiguous same-owner clusters — an empire with two separate
 * pockets of territory gets two clusters, each rendered with its own merged logo footprint
 * (see components/hexgrid/BrandHexTile.tsx).
 */
export function clusterHexesByOwner(hexes: HexTile[]): OwnedCluster[] {
  const byKey = new Map<string, HexTile>()
  for (const hex of hexes) {
    if (hex.ownerId) byKey.set(axialKey(hex.coord), hex)
  }

  const visited = new Set<string>()
  const clusters: OwnedCluster[] = []

  for (const hex of byKey.values()) {
    const key = axialKey(hex.coord)
    if (visited.has(key)) continue

    const ownerId = hex.ownerId as string
    const coordCluster = floodFillCluster(hex.coord, (coord) => {
      const neighbor = byKey.get(axialKey(coord))
      return neighbor?.ownerId === ownerId
    })

    const hexCluster = coordCluster
      .map((coord) => byKey.get(axialKey(coord)))
      .filter((h): h is HexTile => h !== undefined)

    for (const h of hexCluster) visited.add(axialKey(h.coord))
    clusters.push({ ownerId, hexes: hexCluster })
  }

  return clusters
}

/**
 * Partitions bare coordinates into contiguous groups, ignoring ownership entirely.
 *
 * Used for the pending-claim preview, where every coordinate belongs to the same prospective buyer
 * and the only question is which of them touch each other.
 */
export function clusterCoordsByAdjacency(coords: AxialCoord[]): AxialCoord[][] {
  const members = new Set(coords.map(axialKey))
  const visited = new Set<string>()
  const clusters: AxialCoord[][] = []

  for (const coord of coords) {
    const key = axialKey(coord)
    if (visited.has(key)) continue

    const cluster = floodFillCluster(coord, (candidate) => members.has(axialKey(candidate)))
    for (const member of cluster) visited.add(axialKey(member))
    clusters.push(cluster)
  }

  return clusters
}
