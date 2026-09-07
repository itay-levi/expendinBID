import { describe, expect, it } from 'vitest'
import { clusterHexesByOwner } from './clusterHexes'
import type { HexTile } from '@/types/game'

function makeHex(q: number, r: number, ownerId: string | null): HexTile {
  return {
    id: `hex_${q},${r}`,
    coord: { q, r },
    ownerId,
    isCapital: false,
    lastPricePaidCents: 1000,
    isContested: false,
    ownedSince: ownerId ? '2026-01-01T00:00:00.000Z' : null,
    lockedUntil: null,
  }
}

describe('clusterHexesByOwner', () => {
  it('groups adjacent same-owner hexes into one cluster, ignoring unowned hexes', () => {
    const hexes = [
      makeHex(0, 0, 'stripe'),
      makeHex(1, 0, 'stripe'),
      makeHex(2, 0, null), // unclaimed gap, not part of any cluster
      makeHex(5, 5, 'vercel'),
    ]

    const clusters = clusterHexesByOwner(hexes)
    expect(clusters).toHaveLength(2)

    const stripeCluster = clusters.find((c) => c.ownerId === 'stripe')
    expect(stripeCluster?.hexes).toHaveLength(2)

    const vercelCluster = clusters.find((c) => c.ownerId === 'vercel')
    expect(vercelCluster?.hexes).toHaveLength(1)
  })

  it('splits one empire into two clusters when its territory is disconnected', () => {
    const hexes = [
      makeHex(0, 0, 'stripe'),
      makeHex(1, 0, 'stripe'),
      // gap at (2,0) owned by a rival breaks contiguity
      makeHex(2, 0, 'vercel'),
      makeHex(3, 0, 'stripe'),
    ]

    const clusters = clusterHexesByOwner(hexes)
    const stripeClusters = clusters.filter((c) => c.ownerId === 'stripe')

    expect(stripeClusters).toHaveLength(2)
    expect(stripeClusters.map((c) => c.hexes.length).sort()).toEqual([1, 2])
  })
})
