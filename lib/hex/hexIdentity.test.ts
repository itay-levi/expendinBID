import { describe, expect, it } from 'vitest'
import {
  coordFromHexId,
  hexIdFor,
  requiredMapRadius,
  resolveHexAt,
  resolveHexById,
  unownedHexAt,
} from './hexIdentity'
import { BASE_HEX_PRICE_CENTS } from '@/lib/pricing/takeoverPricing'
import type { HexTile } from '@/types/game'
import type { AxialCoord } from './hexMath'

const ownedTile: HexTile = {
  id: 'hex_1,2',
  coord: { q: 1, r: 2 },
  ownerId: 'acme.com',
  isCapital: true,
  lastPricePaidCents: 4_500,
  isContested: false,
  ownedSince: '2026-01-01T00:00:00.000Z',
  lockedUntil: null,
}

describe('hexIdFor / coordFromHexId', () => {
  it('round-trips any coordinate, including negatives and far-off ones', () => {
    const coords: AxialCoord[] = [
      { q: 0, r: 0 },
      { q: 1, r: 2 },
      { q: -3, r: 4 },
      { q: -12, r: -99 },
      { q: 1_000_000, r: -1_000_000 },
    ]
    for (const coord of coords) {
      expect(coordFromHexId(hexIdFor(coord))).toEqual(coord)
    }
  })

  it('rejects malformed ids rather than throwing on untrusted input', () => {
    const malformed = [
      '',
      'hex_',
      'hex_1',
      'hex_1,',
      'hex_,1',
      'hex_1,2,3',
      'hex_a,b',
      'hex_1.5,2',
      'hex_ 1,2',
      'hex_1, 2',
      'HEX_1,2',
      'prefix_1,2',
      'hex_1,2 ',
      'hex_+1,2',
      'hex_1,2\n',
      // A newline-separated second line must not sneak past an unanchored pattern.
      'hex_1,2\nhex_3,4',
    ]
    for (const id of malformed) {
      expect(coordFromHexId(id)).toBeNull()
    }
  })

  it('rejects coordinates beyond safe integer range', () => {
    // Past 2^53 the parsed value is imprecise, so arithmetic on it would silently be wrong.
    expect(coordFromHexId('hex_99999999999999999999,0')).toBeNull()
    expect(coordFromHexId('hex_0,-99999999999999999999')).toBeNull()
  })
})

describe('unownedHexAt', () => {
  it('derives a complete, unclaimed tile at base price', () => {
    expect(unownedHexAt({ q: 5, r: -5 })).toEqual({
      id: 'hex_5,-5',
      coord: { q: 5, r: -5 },
      ownerId: null,
      isCapital: false,
      lastPricePaidCents: BASE_HEX_PRICE_CENTS,
      isContested: false,
      ownedSince: null,
      lockedUntil: null,
    })
  })

  it('works for a coordinate no stored map ever covered — the infinite-map guarantee', () => {
    const far = unownedHexAt({ q: 4_000_000, r: -4_000_000 })
    expect(far.ownerId).toBeNull()
    expect(far.lastPricePaidCents).toBe(BASE_HEX_PRICE_CENTS)
  })
})

describe('resolveHexAt / resolveHexById', () => {
  const owned = new Map<string, HexTile>([[ownedTile.id, ownedTile]])

  it('returns the stored row when one exists', () => {
    expect(resolveHexAt(owned, { q: 1, r: 2 })).toBe(ownedTile)
    expect(resolveHexById(owned, 'hex_1,2')).toBe(ownedTile)
  })

  it('synthesizes an unclaimed tile when none is stored', () => {
    expect(resolveHexAt(owned, { q: 9, r: 9 }).ownerId).toBeNull()
    expect(resolveHexById(owned, 'hex_9,9')?.ownerId).toBeNull()
  })

  it('returns null only for a malformed id', () => {
    expect(resolveHexById(owned, 'not-a-hex')).toBeNull()
  })
})

describe('requiredMapRadius', () => {
  it('holds at the minimum while territory stays well inside it', () => {
    expect(requiredMapRadius([{ q: 0, r: 0 }, { q: 2, r: -1 }], 12, 4)).toBe(12)
  })

  it('pushes the frontier outward as territory approaches the edge', () => {
    // A hex 11 rings out with a 4-ring buffer needs radius 15, not the 12 minimum.
    expect(requiredMapRadius([{ q: 11, r: 0 }], 12, 4)).toBe(15)
  })

  it('keeps growing without bound, so the map never has a wall', () => {
    expect(requiredMapRadius([{ q: 5_000, r: 0 }], 12, 4)).toBe(5_004)
  })

  it('is driven by the farthest hex, not the most recent one', () => {
    expect(requiredMapRadius([{ q: 40, r: 0 }, { q: 1, r: 0 }], 12, 4)).toBe(44)
  })

  it('falls back to the minimum for an empty map', () => {
    expect(requiredMapRadius([], 12, 4)).toBe(12)
  })
})
