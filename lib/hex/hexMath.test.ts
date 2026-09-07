import { describe, expect, it } from 'vitest'
import {
  axialToPixel,
  floodFillCluster,
  generateHexagonGrid,
  hexDistance,
  hexNeighbors,
  hexRound,
  pixelToHex,
} from './hexMath'

describe('axialToPixel / pixelToHex round-trip', () => {
  it('recovers the original hex for exact center points', () => {
    const size = 1
    for (const hex of generateHexagonGrid(3)) {
      const pixel = axialToPixel(hex, size)
      expect(pixelToHex(pixel, size)).toEqual(hex)
    }
  })

  it('snaps a point near a hex edge to the nearest hex, not a torn/invalid one', () => {
    const size = 1
    const center = axialToPixel({ q: 2, r: -1 }, size)
    const nudged = { x: center.x + 0.05, z: center.z - 0.03 }
    const result = pixelToHex(nudged, size)
    expect(result).toEqual({ q: 2, r: -1 })
  })
})

describe('hexRound', () => {
  it('always returns a valid cube coordinate (x + y + z = 0)', () => {
    const fractional = { x: 1.6, y: -2.2, z: 0.6 }
    const rounded = hexRound(fractional)
    expect(rounded.x + rounded.y + rounded.z).toBe(0)
  })
})

describe('hexNeighbors / hexDistance', () => {
  it('produces exactly 6 neighbors, each at distance 1', () => {
    const origin = { q: 0, r: 0 }
    const neighbors = hexNeighbors(origin)
    expect(neighbors).toHaveLength(6)
    for (const n of neighbors) {
      expect(hexDistance(origin, n)).toBe(1)
    }
  })

  it('distance is symmetric and zero for a hex to itself', () => {
    const a = { q: 3, r: -2 }
    const b = { q: -1, r: 4 }
    expect(hexDistance(a, b)).toBe(hexDistance(b, a))
    expect(hexDistance(a, a)).toBe(0)
  })
})

describe('generateHexagonGrid', () => {
  it('produces the known hex-count formula 3r^2 + 3r + 1', () => {
    for (const radius of [0, 1, 2, 5]) {
      const expected = 3 * radius * radius + 3 * radius + 1
      expect(generateHexagonGrid(radius)).toHaveLength(expected)
    }
  })
})

describe('floodFillCluster', () => {
  it('collects only contiguously-connected same-owner hexes', () => {
    // Cluster shaped like: origin + 2 neighbors joined in an L, plus one disconnected outlier
    // that shares an owner but is NOT adjacent to the cluster and must be excluded.
    const owned = new Set(['0,0', '1,0', '1,-1', '5,5'])
    const origin = { q: 0, r: 0 }
    const isSameOwner = (hex: { q: number; r: number }) => owned.has(`${hex.q},${hex.r}`)

    const cluster = floodFillCluster(origin, isSameOwner)
    const keys = cluster.map((h) => `${h.q},${h.r}`).sort()

    expect(keys).toEqual(['0,0', '1,-1', '1,0'])
  })
})
