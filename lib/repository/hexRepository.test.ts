import { describe, expect, it, beforeEach } from 'vitest'
import { __resetInMemoryHexes, inMemoryHexRepository } from './hexRepository'
import { BASE_HEX_PRICE_CENTS } from '@/lib/pricing/takeoverPricing'
import type { HexTile } from '@/types/game'

function ownedHex(q: number, r: number, ownerId: string, lastPricePaidCents = 1_500): HexTile {
  return {
    id: `hex_${q},${r}`,
    coord: { q, r },
    ownerId,
    isCapital: false,
    lastPricePaidCents,
    isContested: false,
    ownedSince: '2026-01-01T00:00:00.000Z',
    lockedUntil: null,
  }
}

describe('inMemoryHexRepository', () => {
  beforeEach(() => {
    __resetInMemoryHexes([ownedHex(0, 0, 'acme.com'), ownedHex(1, 0, 'rival.com')])
  })

  describe('getHexById', () => {
    it('returns a stored hex', async () => {
      const hex = await inMemoryHexRepository.getHexById('hex_0,0')
      expect(hex?.ownerId).toBe('acme.com')
    })

    it('derives an unclaimed hex that was never stored — the infinite-map guarantee', async () => {
      // The key behaviour: the server can price and validate a hex nobody has ever touched,
      // arbitrarily far out, without a row existing for it anywhere.
      const hex = await inMemoryHexRepository.getHexById('hex_900000,-900000')
      expect(hex).not.toBeNull()
      expect(hex?.ownerId).toBeNull()
      expect(hex?.lastPricePaidCents).toBe(BASE_HEX_PRICE_CENTS)
      expect(hex?.coord).toEqual({ q: 900_000, r: -900_000 })
    })

    it('returns null for a malformed id rather than inventing a hex', async () => {
      expect(await inMemoryHexRepository.getHexById('nonsense')).toBeNull()
      expect(await inMemoryHexRepository.getHexById('hex_1')).toBeNull()
      expect(await inMemoryHexRepository.getHexById('hex_a,b')).toBeNull()
    })
  })

  describe('getHexesByIds', () => {
    it('resolves owned and unowned ids together in one call', async () => {
      const result = await inMemoryHexRepository.getHexesByIds(['hex_0,0', 'hex_50,50'])
      expect(result.get('hex_0,0')?.ownerId).toBe('acme.com')
      expect(result.get('hex_50,50')?.ownerId).toBeNull()
      expect(result.size).toBe(2)
    })

    it('omits malformed ids from the result so callers can detect them', async () => {
      const result = await inMemoryHexRepository.getHexesByIds(['hex_0,0', 'garbage'])
      expect(result.has('garbage')).toBe(false)
      expect(result.size).toBe(1)
    })

    it('handles an empty request', async () => {
      expect((await inMemoryHexRepository.getHexesByIds([])).size).toBe(0)
    })
  })

  describe('getNeighborOwners', () => {
    it('returns owners of the six surrounding hexes, and nothing else', async () => {
      const owners = await inMemoryHexRepository.getNeighborOwners([{ q: 0, r: 0 }])
      // (1,0) is a neighbour of the origin and is owned; the origin itself is not its own neighbour.
      expect(owners.get('hex_1,0')).toBe('rival.com')
      expect(owners.has('hex_0,0')).toBe(false)
    })

    it('omits unowned neighbours instead of storing nulls', async () => {
      const owners = await inMemoryHexRepository.getNeighborOwners([{ q: 0, r: 0 }])
      expect(owners.has('hex_0,1')).toBe(false)
    })

    it('is bounded by the request, not by how much of the map has been sold', async () => {
      // The scaling property the interface exists for: adding far-away territory must not change
      // the size of a neighbour lookup. A full-map read would grow here; this must not.
      const before = await inMemoryHexRepository.getNeighborOwners([{ q: 0, r: 0 }])
      __resetInMemoryHexes([
        ownedHex(0, 0, 'acme.com'),
        ownedHex(1, 0, 'rival.com'),
        ...Array.from({ length: 500 }, (_, i) => ownedHex(1000 + i, 0, 'noise.com')),
      ])
      const after = await inMemoryHexRepository.getNeighborOwners([{ q: 0, r: 0 }])
      expect(after.size).toBe(before.size)
    })

    it('deduplicates shared neighbours across several coordinates', async () => {
      const owners = await inMemoryHexRepository.getNeighborOwners([
        { q: 0, r: 0 },
        { q: 2, r: 0 },
      ])
      // (1,0) borders both, and must appear once.
      expect(owners.get('hex_1,0')).toBe('rival.com')
    })

    it('handles an empty request', async () => {
      expect((await inMemoryHexRepository.getNeighborOwners([])).size).toBe(0)
    })
  })

  describe('applyTakeover', () => {
    it('updates an owned hex', async () => {
      const updated = await inMemoryHexRepository.applyTakeover('hex_0,0', {
        ownerId: 'newowner.com',
        lastPricePaidCents: 2_250,
      })
      expect(updated.ownerId).toBe('newowner.com')
      expect(updated.lastPricePaidCents).toBe(2_250)
      expect((await inMemoryHexRepository.getHexById('hex_0,0'))?.ownerId).toBe('newowner.com')
    })

    it('claims a never-before-seen hex, creating the row on first sale', async () => {
      const updated = await inMemoryHexRepository.applyTakeover('hex_777,-777', {
        ownerId: 'pioneer.com',
        lastPricePaidCents: BASE_HEX_PRICE_CENTS,
      })
      expect(updated.ownerId).toBe('pioneer.com')
      expect(updated.coord).toEqual({ q: 777, r: -777 })
      expect((await inMemoryHexRepository.getHexById('hex_777,-777'))?.ownerId).toBe('pioneer.com')
    })

    it('leaves unmentioned fields alone', async () => {
      const updated = await inMemoryHexRepository.applyTakeover('hex_0,0', { isContested: true })
      expect(updated.isContested).toBe(true)
      expect(updated.lastPricePaidCents).toBe(1_500)
    })

    it('rejects a malformed id rather than creating a phantom row', async () => {
      await expect(inMemoryHexRepository.applyTakeover('not-a-hex', { ownerId: 'x.com' })).rejects.toThrow(
        /Malformed hex id/,
      )
    })
  })

  describe('__resetInMemoryHexes', () => {
    it('drops unowned hexes, keeping the store to sold tiles only', () => {
      __resetInMemoryHexes([
        ownedHex(0, 0, 'acme.com'),
        { ...ownedHex(5, 5, 'x.com'), ownerId: null },
      ])
      return expect(inMemoryHexRepository.getHexById('hex_5,5')).resolves.toMatchObject({ ownerId: null })
    })

    it('clears everything when called with no arguments', async () => {
      __resetInMemoryHexes()
      expect((await inMemoryHexRepository.getHexById('hex_0,0'))?.ownerId).toBeNull()
    })
  })
})
