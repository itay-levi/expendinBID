import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createPostgresHexRepository } from './postgresHexRepository'
import { BASE_HEX_PRICE_CENTS } from '@/lib/pricing/takeoverPricing'
import type { Database, SqlTransaction } from '@/lib/db/client'
import type { HexRepository, TakeoverBatchItem } from './hexRepository'

/**
 * applyTakeoverBatch against real Postgres (PGlite), because the property under test — compare and
 * write under the same row locks, all or nothing — only means anything against a real engine.
 */
let pglite: PGlite
let repository: HexRepository

beforeAll(async () => {
  pglite = new PGlite()
  const db: Database = {
    driver: 'pglite',
    async query(text, params) {
      const result = await pglite.query(text, params as unknown[])
      return { rows: result.rows as never[] }
    },
    async exec(sql) {
      await pglite.exec(sql)
    },
    async transaction(work) {
      return pglite.transaction(async (tx) =>
        work({
          query: async (text, params) => {
            const result = await tx.query(text, params as unknown[])
            return { rows: result.rows as never[] }
          },
          exec: async (sql) => {
            await tx.exec(sql)
          },
        } as SqlTransaction),
      ) as Promise<never>
    },
    async close() {
      await pglite.close()
    },
  }
  await pglite.exec(await readFile(path.join(process.cwd(), 'db', 'migrations', '0001_init.sql'), 'utf-8'))
  repository = createPostgresHexRepository(db)
})

afterAll(async () => {
  await pglite.close()
})

beforeEach(async () => {
  await pglite.exec('TRUNCATE hexes, takeover_events, empires RESTART IDENTITY CASCADE')
  await pglite.query(
    `INSERT INTO empires (id, domain, url, name) VALUES
       ('acme.com','acme.com','https://acme.com','Acme'),
       ('rival.com','rival.com','https://rival.com','Rival'),
       ('other.com','other.com','https://other.com','Other')`,
  )
})

const NOW = new Date('2026-09-11T12:00:00.000Z')
const OPEN: TakeoverBatchItem['expected'] = { ownerId: null, lastPricePaidCents: BASE_HEX_PRICE_CENTS }

const buy = (hexId: string, ownerId = 'acme.com', expected = OPEN, pricePaidCents = 2_500): TakeoverBatchItem => ({
  hexId,
  expected,
  ownerId,
  pricePaidCents,
  lockedUntil: null,
})

async function ledgerCount(): Promise<number> {
  const { rows } = await pglite.query<{ n: number }>('SELECT count(*)::int AS n FROM takeover_events')
  return rows[0]?.n ?? 0
}

async function ownerOf(hexId: string): Promise<string | null> {
  return (await repository.getHexById(hexId))?.ownerId ?? null
}

describe('applyTakeoverBatch', () => {
  it('writes every tile and its ledger entry together', async () => {
    const result = await repository.applyTakeoverBatch([buy('hex_0,0'), buy('hex_1,0')], NOW)

    expect(result.applied).toBe(true)
    expect(await ownerOf('hex_0,0')).toBe('acme.com')
    expect(await ownerOf('hex_1,0')).toBe('acme.com')
    expect((await repository.getHexById('hex_0,0'))?.lastPricePaidCents).toBe(2_500)
    expect(await ledgerCount()).toBe(2)
  })

  it('returns tiles in the caller’s order and reports who held them before', async () => {
    await repository.applyTakeoverBatch([buy('hex_5,0', 'rival.com')], NOW)
    const result = await repository.applyTakeoverBatch(
      [buy('hex_9,9'), buy('hex_5,0', 'acme.com', { ownerId: 'rival.com', lastPricePaidCents: 2_500 })],
      NOW,
    )
    expect(result).toMatchObject({ applied: true, previousOwners: [null, 'rival.com'] })
    if (result.applied) expect(result.hexes.map((hex) => hex.id)).toEqual(['hex_9,9', 'hex_5,0'])
  })

  it('refuses a stale quote under the lock and writes nothing', async () => {
    await repository.applyTakeoverBatch([buy('hex_0,0', 'rival.com')], NOW)
    const before = await ledgerCount()

    // Quoted while the tile was open ground; it has since been bought.
    const result = await repository.applyTakeoverBatch([buy('hex_0,0')], NOW)

    expect(result).toMatchObject({ applied: false })
    expect(await ownerOf('hex_0,0')).toBe('rival.com')
    expect(await ledgerCount()).toBe(before)
  })

  it('applies all of a purchase or none of it', async () => {
    await repository.applyTakeoverBatch([buy('hex_2,0', 'rival.com')], NOW)
    const result = await repository.applyTakeoverBatch([buy('hex_1,0'), buy('hex_2,0')], NOW)

    expect(result.applied).toBe(false)
    // The tile that was still available is NOT granted on its own.
    expect(await ownerOf('hex_1,0')).toBeNull()
  })

  it('lets exactly one of two simultaneous first claims on the same tile win', async () => {
    // Open ground has no row to lock, which is exactly where check-then-write used to double-sell.
    const [first, second] = await Promise.all([
      repository.applyTakeoverBatch([buy('hex_7,7', 'acme.com')], NOW),
      repository.applyTakeoverBatch([buy('hex_7,7', 'other.com')], NOW),
    ])

    expect([first.applied, second.applied].filter(Boolean)).toHaveLength(1)
    const winner = first.applied ? 'acme.com' : 'other.com'
    expect(await ownerOf('hex_7,7')).toBe(winner)
    expect(await ledgerCount()).toBe(1)
  })

  it('refuses a tile whose owner bought protection after the quote', async () => {
    const lockedUntil = new Date(NOW.getTime() + 60_000).toISOString()
    await repository.applyTakeoverBatch([{ ...buy('hex_3,3', 'rival.com'), lockedUntil }], NOW)

    const result = await repository.applyTakeoverBatch(
      [buy('hex_3,3', 'acme.com', { ownerId: 'rival.com', lastPricePaidCents: 2_500 })],
      NOW,
    )
    expect(result).toMatchObject({ applied: false })
    expect(await ownerOf('hex_3,3')).toBe('rival.com')
  })

  it('refuses a basket that lists the same tile twice', async () => {
    const result = await repository.applyTakeoverBatch([buy('hex_0,0'), buy('hex_0,0')], NOW)
    expect(result).toEqual({ applied: false, conflicts: ['Duplicate hex in settlement'] })
  })

  it('refuses a malformed id without touching the database', async () => {
    const result = await repository.applyTakeoverBatch([buy('garbage')], NOW)
    expect(result).toMatchObject({ applied: false })
    expect(await ledgerCount()).toBe(0)
  })
})
