import { beforeEach, describe, expect, it, vi } from 'vitest'
import { settleTakeover } from './settleTakeover'
import { __resetInMemoryHexes, inMemoryHexRepository } from '@/lib/repository/hexRepository'
import { inMemoryEmpireRepository } from '@/lib/repository/empireRepository'
import { fingerprintHexes, type HexFingerprint } from '@/lib/hex/takeoverGuard'
import { hexIdFor, unownedHexAt } from '@/lib/hex/hexIdentity'
import { PROTECTION_DURATION_MS } from '@/lib/pricing/takeoverPricing'
import type { HexTile } from '@/types/game'

vi.mock('@/lib/notifications/retaliationNotifier', () => ({ notifyDefenderOfTakeover: vi.fn(async () => undefined) }))

const repositories = { hexes: inMemoryHexRepository, empires: inMemoryEmpireRepository }
const NOW = new Date('2026-09-11T12:00:00.000Z')
let buyerCount = 0

/** A fresh buyer per test: the in-memory empire store is shared across the whole file. */
function nextBuyerUrl(): string {
  buyerCount += 1
  return `https://buyer-${buyerCount}.test`
}

const metadataFor = (url: string) => ({
  title: 'Buyer',
  description: 'Buyer Co',
  logoUrl: 'https://buyer.test/logo.png',
  sourceUrl: url,
})

function owned(q: number, r: number, ownerId: string, price = 1_000): HexTile {
  return { ...unownedHexAt({ q, r }), ownerId, lastPricePaidCents: price, ownedSince: '2026-01-01T00:00:00.000Z' }
}

/** Captures the quote the way checkout does: fingerprints of the tiles as they are right now. */
async function quote(ids: string[]): Promise<Map<string, HexFingerprint>> {
  const found = await inMemoryHexRepository.getHexesByIds(ids)
  return new Map(fingerprintHexes(ids.map((id) => found.get(id)!)).map((f) => [f.hexId, f]))
}

const ids = (...coords: Array<[number, number]>) => coords.map(([q, r]) => hexIdFor({ q, r }))

beforeEach(() => {
  __resetInMemoryHexes([])
})

describe('settleTakeover', () => {
  it('records the price that was actually charged, split evenly across the tiles', async () => {
    // Four connected open tiles cost $10 + $20 + $30 + $40 = $100. The old webhook formula wrote
    // this down as four tiles at $9.
    const hexIds = ids([0, 0], [1, 0], [2, 0], [3, 0])
    const url = nextBuyerUrl()
    const result = await settleTakeover(repositories, {
      hexIds,
      targetUrl: url,
      metadata: metadataFor(url),
      primaryColorHex: '#635BFF',
      protect: false,
      expected: await quote(hexIds),
      now: NOW,
    })

    expect(result.applied).toBe(true)
    if (!result.applied) return
    expect(result.territoryCents).toBe(10_000)
    expect(result.hexes.map((hex) => hex.lastPricePaidCents)).toEqual([2_500, 2_500, 2_500, 2_500])
    expect(result.hexes.every((hex) => hex.ownerId === new URL(url).hostname)).toBe(true)
  })

  it('lets a basket fight inward through a tile bought in the same purchase', async () => {
    // Rival holds (0,0) and (1,0). Taking (1,0) is only reachable via (2,0), bought alongside it —
    // exactly what checkout allows. Settlement used to judge (1,0) on its own and refuse a payment
    // that had already been taken.
    __resetInMemoryHexes([owned(0, 0, 'rival.test'), owned(1, 0, 'rival.test')])
    const hexIds = ids([2, 0], [1, 0])
    const url = nextBuyerUrl()
    const result = await settleTakeover(repositories, {
      hexIds,
      targetUrl: url,
      metadata: metadataFor(url),
      primaryColorHex: undefined,
      protect: false,
      expected: await quote(hexIds),
      now: NOW,
    })
    expect(result.applied).toBe(true)
  })

  it('refuses when a tile changed hands after the quote, and applies nothing', async () => {
    const hexIds = ids([0, 0], [1, 0])
    const expected = await quote(hexIds)
    // Somebody else's payment settles first for one of the two tiles.
    __resetInMemoryHexes([owned(1, 0, 'faster.test')])

    const url = nextBuyerUrl()
    const result = await settleTakeover(repositories, {
      hexIds,
      targetUrl: url,
      metadata: metadataFor(url),
      primaryColorHex: undefined,
      protect: false,
      expected,
      now: NOW,
    })

    expect(result).toMatchObject({ applied: false, reason: 'state_conflict' })
    // All or nothing: the untouched tile is not granted on its own.
    expect((await inMemoryHexRepository.getHexById(hexIdFor({ q: 0, r: 0 })))?.ownerId).toBeNull()
  })

  it('fails closed when a tile has no recorded quote', async () => {
    const url = nextBuyerUrl()
    const result = await settleTakeover(repositories, {
      hexIds: ids([5, 5]),
      targetUrl: url,
      metadata: metadataFor(url),
      primaryColorHex: undefined,
      protect: false,
      expected: new Map(),
      now: NOW,
    })
    expect(result).toMatchObject({ applied: false, reason: 'state_conflict' })
  })

  it('refuses an unknown hex id', async () => {
    const url = nextBuyerUrl()
    const result = await settleTakeover(repositories, {
      hexIds: ['not-a-hex'],
      targetUrl: url,
      metadata: metadataFor(url),
      primaryColorHex: undefined,
      protect: false,
      expected: new Map(),
      now: NOW,
    })
    expect(result).toMatchObject({ applied: false, reason: 'unknown_hex' })
  })

  it('protects the tiles for the paid window when protection was bought', async () => {
    const hexIds = ids([0, 0])
    const url = nextBuyerUrl()
    const result = await settleTakeover(repositories, {
      hexIds,
      targetUrl: url,
      metadata: metadataFor(url),
      primaryColorHex: undefined,
      protect: true,
      expected: await quote(hexIds),
      now: NOW,
    })
    expect(result.applied).toBe(true)
    if (!result.applied) return
    expect(result.hexes[0]?.lockedUntil).toBe(new Date(NOW.getTime() + PROTECTION_DURATION_MS).toISOString())
  })

  it('stores a colour that has been normalized, whatever the client sent', async () => {
    const hexIds = ids([0, 0])
    const url = nextBuyerUrl()
    const result = await settleTakeover(repositories, {
      hexIds,
      targetUrl: url,
      metadata: metadataFor(url),
      primaryColorHex: '#fff;background:url(x)',
      protect: false,
      expected: await quote(hexIds),
      now: NOW,
    })
    expect(result.applied).toBe(true)
    if (!result.applied) return
    expect(result.empire.primaryColorHex).toMatch(/^#[0-9A-F]{6}$/)
  })
})
