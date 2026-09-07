import { describe, expect, it } from 'vitest'
import { MAX_VISIBLE_HEXES, hexesInWorldRect, orthographicGroundRect } from './viewport'
import { axialToPixel, axialKey } from './hexMath'

const SIZE = 1

describe('hexesInWorldRect', () => {
  it('includes every hex whose center lies inside the rectangle', () => {
    const rect = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }
    const found = new Set(hexesInWorldRect(rect, SIZE).map(axialKey))

    // Independently brute-force the same answer over a generous candidate range.
    for (let q = -20; q <= 20; q += 1) {
      for (let r = -20; r <= 20; r += 1) {
        const pixel = axialToPixel({ q, r }, SIZE)
        const inside =
          pixel.x >= rect.minX && pixel.x <= rect.maxX && pixel.z >= rect.minZ && pixel.z <= rect.maxZ
        if (inside) expect(found.has(axialKey({ q, r }))).toBe(true)
      }
    }
  })

  it('costs the same far from the origin as it does at it — the point of an infinite map', () => {
    const atOrigin = hexesInWorldRect({ minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, SIZE)
    const farAway = hexesInWorldRect(
      { minX: 149_980, maxX: 150_020, minZ: 149_980, maxZ: 150_020 },
      SIZE,
    )
    // Within a column of each other, not exactly equal: a fixed-size window straddles the hex
    // lattice differently depending on where it lands, so the count legitimately varies by a
    // row or column. What matters is that it does not grow with distance.
    expect(Math.abs(farAway.length - atOrigin.length)).toBeLessThanOrEqual(2)
  })

  it('returns coordinates that actually round-trip to the requested region', () => {
    const rect = { minX: 1000, maxX: 1020, minZ: -500, maxZ: -480 }
    for (const coord of hexesInWorldRect(rect, SIZE)) {
      const pixel = axialToPixel(coord, SIZE)
      // Within the rect plus the one-hex margin the generator deliberately adds.
      expect(pixel.x).toBeGreaterThan(rect.minX - 4)
      expect(pixel.x).toBeLessThan(rect.maxX + 4)
      expect(pixel.z).toBeGreaterThan(rect.minZ - 4)
      expect(pixel.z).toBeLessThan(rect.maxZ + 4)
    }
  })

  it('emits no duplicate coordinates', () => {
    const coords = hexesInWorldRect({ minX: -30, maxX: 30, minZ: -30, maxZ: 30 }, SIZE)
    expect(new Set(coords.map(axialKey)).size).toBe(coords.length)
  })

  it('clamps rather than hanging when the camera is zoomed absurdly far out', () => {
    const coords = hexesInWorldRect({ minX: -1e6, maxX: 1e6, minZ: -1e6, maxZ: 1e6 }, SIZE)
    expect(coords.length).toBeLessThanOrEqual(MAX_VISIBLE_HEXES)
  })

  it('honours a caller-supplied cap', () => {
    expect(hexesInWorldRect({ minX: -50, maxX: 50, minZ: -50, maxZ: 50 }, SIZE, 25)).toHaveLength(25)
  })

  it('scales the hex count with size, not with distance from origin', () => {
    const small = hexesInWorldRect({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, 1)
    const large = hexesInWorldRect({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, 4)
    expect(large.length).toBeLessThan(small.length)
  })

  it('rejects degenerate input instead of looping forever', () => {
    expect(hexesInWorldRect({ minX: 0, maxX: 10, minZ: 0, maxZ: 10 }, 0)).toEqual([])
    expect(hexesInWorldRect({ minX: 0, maxX: 10, minZ: 0, maxZ: 10 }, -1)).toEqual([])
    expect(hexesInWorldRect({ minX: 10, maxX: 0, minZ: 0, maxZ: 10 }, 1)).toEqual([])
    expect(hexesInWorldRect({ minX: 0, maxX: 10, minZ: 10, maxZ: 0 }, 1)).toEqual([])
    expect(hexesInWorldRect({ minX: NaN, maxX: 10, minZ: 0, maxZ: 10 }, 1)).toEqual([])
    expect(hexesInWorldRect({ minX: 0, maxX: Infinity, minZ: 0, maxZ: 10 }, 1)).toEqual([])
    expect(hexesInWorldRect({ minX: 0, maxX: 10, minZ: NaN, maxZ: 10 }, 1)).toEqual([])
    expect(hexesInWorldRect({ minX: 0, maxX: 10, minZ: 0, maxZ: NaN }, 1)).toEqual([])
  })
})

describe('orthographicGroundRect', () => {
  it('centers the rectangle on the camera target', () => {
    const rect = orthographicGroundRect({ x: 100, z: -50 }, 1920, 1080, 40, 0.6155, 0)
    expect((rect.minX + rect.maxX) / 2).toBeCloseTo(100, 6)
    expect((rect.minZ + rect.maxZ) / 2).toBeCloseTo(-50, 6)
  })

  it('covers less ground as zoom increases', () => {
    const zoomedOut = orthographicGroundRect({ x: 0, z: 0 }, 1920, 1080, 20, 0.6155, 0)
    const zoomedIn = orthographicGroundRect({ x: 0, z: 0 }, 1920, 1080, 80, 0.6155, 0)
    expect(zoomedIn.maxX - zoomedIn.minX).toBeLessThan(zoomedOut.maxX - zoomedOut.minX)
  })

  it('covers more depth than width for the same pixels, because the ground is seen at a tilt', () => {
    const rect = orthographicGroundRect({ x: 0, z: 0 }, 1000, 1000, 40, 0.6155, 0)
    expect(rect.maxZ - rect.minZ).toBeGreaterThan(rect.maxX - rect.minX)
  })

  it('expands by the requested padding on every side', () => {
    const bare = orthographicGroundRect({ x: 0, z: 0 }, 1920, 1080, 40, 0.6155, 0)
    const padded = orthographicGroundRect({ x: 0, z: 0 }, 1920, 1080, 40, 0.6155, 5)
    expect(padded.minX).toBeCloseTo(bare.minX - 5, 6)
    expect(padded.maxZ).toBeCloseTo(bare.maxZ + 5, 6)
  })

  it('stays finite at a degenerate top-down tilt instead of dividing by zero', () => {
    const rect = orthographicGroundRect({ x: 0, z: 0 }, 1920, 1080, 40, Math.PI / 2, 0)
    expect(Number.isFinite(rect.minZ)).toBe(true)
    expect(Number.isFinite(rect.maxZ)).toBe(true)
  })

  it('returns an empty rect for a nonsensical zoom rather than NaN bounds', () => {
    expect(orthographicGroundRect({ x: 0, z: 0 }, 1920, 1080, 0, 0.6155, 0)).toEqual({
      minX: 0,
      maxX: 0,
      minZ: 0,
      maxZ: 0,
    })
    expect(orthographicGroundRect({ x: 0, z: 0 }, 1920, 1080, NaN, 0.6155, 0)).toEqual({
      minX: 0,
      maxX: 0,
      minZ: 0,
      maxZ: 0,
    })
  })
})
