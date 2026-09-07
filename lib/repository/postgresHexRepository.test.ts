import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createPostgresHexRepository } from './postgresHexRepository'
import { BASE_HEX_PRICE_CENTS } from '@/lib/pricing/takeoverPricing'
import type { Database, SqlTransaction } from '@/lib/db/client'
import type { HexRepository } from './hexRepository'

/**
 * These run against real Postgres (PGlite is Postgres compiled to WASM), not a mock — so the SQL,
 * the constraints, the ON CONFLICT behaviour and the transaction semantics exercised here are the
 * same ones production runs.
 */
let pglite: PGlite
let db: Database
let repository: HexRepository

beforeAll(async () => {
  pglite = new PGlite() // in-memory: tests should not leave a database behind
  db = {
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

  const sql = await readFile(path.join(process.cwd(), 'db', 'migrations', '0001_init.sql'), 'utf-8')
  await pglite.exec(sql)
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
       ('rival.com','rival.com','https://rival.com','Rival')`,
  )
})

describe('createPostgresHexRepository', () => {
  it('derives an unclaimed hex for a coordinate with no row', async () => {
    const hex = await repository.getHexById('hex_4000,-4000')
    expect(hex?.ownerId).toBeNull()
    expect(hex?.lastPricePaidCents).toBe(BASE_HEX_PRICE_CENTS)
  })

  it('returns null for a malformed id', async () => {
    expect(await repository.getHexById('garbage')).toBeNull()
  })

  it('creates a row on first claim and reads it back', async () => {
    await repository.applyTakeover('hex_0,0', {
      ownerId: 'acme.com',
      lastPricePaidCents: 1_000,
      ownedSince: '2026-01-01T00:00:00.000Z',
    })
    const hex = await repository.getHexById('hex_0,0')
    expect(hex?.ownerId).toBe('acme.com')
    expect(hex?.lastPricePaidCents).toBe(1_000)
  })

  it('converts BIGINT prices back to numbers, not strings', async () => {
    // node-postgres returns BIGINT as a string; without an explicit conversion, price arithmetic
    // silently becomes string concatenation and every takeover is mispriced.
    await repository.applyTakeover('hex_0,0', { ownerId: 'acme.com', lastPricePaidCents: 1_500 })
    const hex = await repository.getHexById('hex_0,0')
    expect(typeof hex?.lastPricePaidCents).toBe('number')
    expect(hex!.lastPricePaidCents * 1.5).toBe(2_250)
  })

  it('takes over an existing row via ON CONFLICT rather than failing', async () => {
    await repository.applyTakeover('hex_0,0', { ownerId: 'acme.com', lastPricePaidCents: 1_000 })
    await repository.applyTakeover('hex_0,0', { ownerId: 'rival.com', lastPricePaidCents: 1_500 })
    const hex = await repository.getHexById('hex_0,0')
    expect(hex?.ownerId).toBe('rival.com')
    expect(hex?.lastPricePaidCents).toBe(1_500)
  })

  it('deletes the row when a hex reverts to open ground', async () => {
    await repository.applyTakeover('hex_0,0', { ownerId: 'acme.com', lastPricePaidCents: 1_000 })
    await repository.applyTakeover('hex_0,0', { ownerId: null })

    const { rows } = await db.query<{ count: string }>('SELECT count(*) AS count FROM hexes')
    expect(Number(rows[0]!.count)).toBe(0)
    expect((await repository.getHexById('hex_0,0'))?.ownerId).toBeNull()
  })

  it('round-trips protection and contested flags', async () => {
    await repository.applyTakeover('hex_2,3', {
      ownerId: 'acme.com',
      lastPricePaidCents: 2_000,
      isContested: true,
      lockedUntil: '2099-01-01T00:00:00.000Z',
      isCapital: true,
    })
    const hex = await repository.getHexById('hex_2,3')
    expect(hex?.isContested).toBe(true)
    expect(hex?.isCapital).toBe(true)
    expect(hex?.lockedUntil).toBe('2099-01-01T00:00:00.000Z')
  })

  it('resolves a mixed basket of owned and unowned ids in one call', async () => {
    await repository.applyTakeover('hex_0,0', { ownerId: 'acme.com', lastPricePaidCents: 1_000 })
    const result = await repository.getHexesByIds(['hex_0,0', 'hex_88,88', 'bogus'])
    expect(result.get('hex_0,0')?.ownerId).toBe('acme.com')
    expect(result.get('hex_88,88')?.ownerId).toBeNull()
    expect(result.has('bogus')).toBe(false)
  })

  it('returns only owned neighbours, keyed by hex id', async () => {
    await repository.applyTakeover('hex_1,0', { ownerId: 'rival.com', lastPricePaidCents: 1_000 })
    const owners = await repository.getNeighborOwners([{ q: 0, r: 0 }])
    expect(owners.get('hex_1,0')).toBe('rival.com')
    expect(owners.has('hex_0,1')).toBe(false)
    expect(owners.has('hex_0,0')).toBe(false)
  })

  it('keeps neighbour lookups bounded as the map fills up', async () => {
    await repository.applyTakeover('hex_1,0', { ownerId: 'rival.com', lastPricePaidCents: 1_000 })
    const before = await repository.getNeighborOwners([{ q: 0, r: 0 }])

    for (let i = 0; i < 200; i += 1) {
      await repository.applyTakeover(`hex_${500 + i},0`, { ownerId: 'rival.com', lastPricePaidCents: 1_000 })
    }
    const after = await repository.getNeighborOwners([{ q: 0, r: 0 }])
    expect(after.size).toBe(before.size)
  })

  it('handles empty inputs without emitting invalid SQL', async () => {
    expect((await repository.getHexesByIds([])).size).toBe(0)
    expect((await repository.getNeighborOwners([])).size).toBe(0)
  })

  it('rolls the whole takeover back when the transaction fails', async () => {
    // A foreign key that doesn't exist: the INSERT must fail and leave nothing behind, rather than
    // committing a hex owned by a non-existent empire.
    await expect(
      repository.applyTakeover('hex_0,0', { ownerId: 'nonexistent.com', lastPricePaidCents: 1_000 }),
    ).rejects.toThrow()

    const { rows } = await db.query<{ count: string }>('SELECT count(*) AS count FROM hexes')
    expect(Number(rows[0]!.count)).toBe(0)
  })

  it('enforces the non-negative price constraint in the database, not just in code', async () => {
    await expect(
      repository.applyTakeover('hex_0,0', { ownerId: 'acme.com', lastPricePaidCents: -1 }),
    ).rejects.toThrow()
  })

  it('does not let a coordinate injected through an id escape parameterisation', async () => {
    // The id pattern already rejects this, but the query builder must never be the thing relied on.
    expect(await repository.getHexById("hex_0,0'); DROP TABLE hexes; --")).toBeNull()
    const { rows } = await db.query<{ count: string }>(
      "SELECT count(*) AS count FROM information_schema.tables WHERE table_name = 'hexes'",
    )
    expect(Number(rows[0]!.count)).toBe(1)
  })
})
