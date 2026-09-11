import { getDatabase, type Database, type SqlTransaction } from '@/lib/db/client'
import { coordFromHexId, hexIdFor, unownedHexAt } from '@/lib/hex/hexIdentity'
import { hexNeighbors, type AxialCoord } from '@/lib/hex/hexMath'
import { batchConflictReason, type HexRepository, type TakeoverBatchItem, type TakeoverBatchResult } from './hexRepository'
import type { HexTile } from '@/types/game'

/**
 * Ceiling on a single map read.
 *
 * The bounding box comes from a client-supplied viewport, so a request can ask for an arbitrarily
 * large window. Without a cap, one crafted request asking for the whole coordinate space would try
 * to load every hex ever sold into memory.
 */
const MAX_HEXES_PER_MAP_READ = 5_000

/** Thrown inside a settlement transaction to roll every write back. Never escapes the repository. */
class SettlementConflict extends Error {}

type LockedTile = { item: TakeoverBatchItem; coord: AxialCoord; existed: boolean; current: HexTile }

type HexRow = {
  q: number
  r: number
  owner_id: string
  is_capital: boolean
  last_price_paid_cents: string | number
  is_contested: boolean
  owned_since: Date | string
  locked_until: Date | string | null
}

function rowToHexTile(row: HexRow): HexTile {
  return {
    id: hexIdFor({ q: row.q, r: row.r }),
    coord: { q: row.q, r: row.r },
    ownerId: row.owner_id,
    isCapital: row.is_capital,
    // BIGINT comes back as a string from node-postgres — it doesn't narrow to a JS number on its
    // own because BIGINT's range exceeds Number.MAX_SAFE_INTEGER. Cent amounts are far below that,
    // so the conversion is safe here, but it has to be explicit or arithmetic becomes concatenation.
    lastPricePaidCents: Number(row.last_price_paid_cents),
    isContested: row.is_contested,
    ownedSince: new Date(row.owned_since).toISOString(),
    lockedUntil: row.locked_until ? new Date(row.locked_until).toISOString() : null,
  }
}

/**
 * Postgres-backed hex storage.
 *
 * Two invariants shape every query here:
 *
 *  1. **Unsold hexes have no row.** A miss is not an error — it is the normal state of almost the
 *     entire map, and it means "unclaimed at base price" (lib/hex/hexIdentity.ts). This is what
 *     makes the map unbounded, and it is why a first purchase is an INSERT and a takeover is an
 *     UPDATE, expressed as one `INSERT ... ON CONFLICT`.
 *  2. **No query may scan the table.** The map has no size limit, so any full read is a query whose
 *     cost grows with total sales forever. Every method below is a primary-key hit or a bounded
 *     `IN` over a caller-supplied key set.
 */
export function createPostgresHexRepository(db: Database = getDatabase()): HexRepository {
  return {
    async getHexById(hexId) {
      const coord = coordFromHexId(hexId)
      if (!coord) return null

      const { rows } = await db.query<HexRow>(
        'SELECT q, r, owner_id, is_capital, last_price_paid_cents, is_contested, owned_since, locked_until FROM hexes WHERE q = $1 AND r = $2',
        [coord.q, coord.r],
      )
      const row = rows[0]
      return row ? rowToHexTile(row) : unownedHexAt(coord)
    },

    async getHexesByIds(hexIds) {
      const result = new Map<string, HexTile>()
      const coordsById = new Map<string, AxialCoord>()
      for (const hexId of hexIds) {
        const coord = coordFromHexId(hexId)
        // Malformed ids are omitted rather than throwing, so the caller can report exactly which
        // of a basket was bad instead of losing the whole request.
        if (coord) coordsById.set(hexId, coord)
      }
      if (coordsById.size === 0) return result

      const stored = await selectHexesAtCoords(db, Array.from(coordsById.values()))
      for (const [hexId, coord] of coordsById) {
        result.set(hexId, stored.get(hexIdFor(coord)) ?? unownedHexAt(coord))
      }
      return result
    },

    async getNeighborOwners(coords) {
      const owners = new Map<string, string>()
      if (coords.length === 0) return owners

      // Deduplicated first: overlapping baskets share neighbours, and sending the same key twice
      // just makes the query text longer.
      const byKey = new Map<string, AxialCoord>()
      for (const coord of coords) {
        for (const neighbor of hexNeighbors(coord)) byKey.set(hexIdFor(neighbor), neighbor)
      }

      const stored = await selectHexesAtCoords(db, Array.from(byKey.values()))
      for (const [hexId, hex] of stored) {
        if (hex.ownerId) owners.set(hexId, hex.ownerId)
      }
      return owners
    },

    async getOwnedHexesInRange(bounds) {
      // Index range scan on the (q, r) composite index, not a scan of the table. Cost tracks the
      // size of the window the camera is looking at, which is what makes an unbounded map viable.
      const { rows } = await db.query<HexRow>(
        `SELECT q, r, owner_id, is_capital, last_price_paid_cents, is_contested, owned_since, locked_until
           FROM hexes
          WHERE q BETWEEN $1 AND $2 AND r BETWEEN $3 AND $4
          LIMIT $5`,
        [bounds.minQ, bounds.maxQ, bounds.minR, bounds.maxR, MAX_HEXES_PER_MAP_READ],
      )
      return rows.map(rowToHexTile)
    },

    async hasAnyTerritory(empireId) {
      // LIMIT 1 on the owner index: existence, not a count. Counting an empire's whole holding
      // to answer a yes/no question gets slower as the biggest empires grow.
      const { rows } = await db.query('SELECT 1 FROM hexes WHERE owner_id = $1 LIMIT 1', [empireId])
      return rows.length > 0
    },

    async recordTakeover(entry) {
      await db.query(
        `INSERT INTO takeover_events (hex_q, hex_r, attacker_empire_id, defender_empire_id, price_paid_cents)
         VALUES ($1, $2, $3, $4, $5)`,
        [entry.coord.q, entry.coord.r, entry.attackerEmpireId, entry.defenderEmpireId, entry.pricePaidCents],
      )
    },

    async applyTakeoverBatch(items, now = new Date()): Promise<TakeoverBatchResult> {
      if (new Set(items.map((item) => item.hexId)).size !== items.length) {
        return { applied: false, conflicts: ['Duplicate hex in settlement'] }
      }
      const located: Array<{ item: TakeoverBatchItem; coord: AxialCoord }> = []
      for (const item of items) {
        const coord = coordFromHexId(item.hexId)
        if (!coord) return { applied: false, conflicts: [`Malformed hex id: ${item.hexId}`] }
        located.push({ item, coord })
      }
      // One global lock order, so two overlapping settlements can never each hold a lock the other
      // is waiting on — the deadlock you get when every transaction locks in its own basket order.
      const lockOrder = [...located].sort((a, b) => a.coord.q - b.coord.q || a.coord.r - b.coord.r)

      try {
        return await db.transaction(async (tx): Promise<TakeoverBatchResult> => {
          const locked: LockedTile[] = []
          for (const { item, coord } of lockOrder) {
            const current = await lockHexForUpdate(tx, coord)
            locked.push({ item, coord, current, existed: current.ownerId !== null })
          }

          // The comparison that makes settlement safe, done while every row is held.
          const conflicts = locked
            .map(({ item, current }) => batchConflictReason(current, item, now))
            .filter((reason): reason is string => reason !== null)
          if (conflicts.length > 0) return { applied: false, conflicts }

          const ownedSince = now.toISOString()
          const written = new Map<string, { hex: HexTile; previousOwner: string | null }>()
          for (const { item, coord, existed, current } of locked) {
            const params = [coord.q, coord.r, item.ownerId, current.isCapital, item.pricePaidCents, false, ownedSince, item.lockedUntil]
            if (existed) {
              await tx.query(
                `UPDATE hexes SET owner_id = $3, is_capital = $4, last_price_paid_cents = $5, is_contested = $6,
                        owned_since = $7, locked_until = $8
                  WHERE q = $1 AND r = $2`,
                params,
              )
            } else {
              const { rows } = await tx.query(
                `INSERT INTO hexes (q, r, owner_id, is_capital, last_price_paid_cents, is_contested, owned_since, locked_until)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (q, r) DO NOTHING
                 RETURNING q`,
                params,
              )
              // Open ground has no row to lock, so a concurrent first claim only shows up here: the
              // other buyer's insert won, and this entire settlement has to roll back.
              if (rows.length === 0) throw new SettlementConflict(`${item.hexId} changed hands before payment settled`)
            }
            await tx.query(
              `INSERT INTO takeover_events (hex_q, hex_r, attacker_empire_id, defender_empire_id, price_paid_cents)
               VALUES ($1, $2, $3, $4, $5)`,
              [coord.q, coord.r, item.ownerId, current.ownerId, item.pricePaidCents],
            )
            written.set(item.hexId, {
              previousOwner: current.ownerId,
              hex: {
                ...current,
                id: hexIdFor(coord),
                coord,
                ownerId: item.ownerId,
                lastPricePaidCents: item.pricePaidCents,
                isContested: false,
                ownedSince,
                lockedUntil: item.lockedUntil,
              },
            })
          }

          // Back in the caller's order, not lock order.
          return {
            applied: true,
            hexes: items.map((item) => written.get(item.hexId)!.hex),
            previousOwners: items.map((item) => written.get(item.hexId)!.previousOwner),
          }
        })
      } catch (error: unknown) {
        if (error instanceof SettlementConflict) return { applied: false, conflicts: [error.message] }
        throw error
      }
    },

    async applyTakeover(hexId, updates) {
      const coord = coordFromHexId(hexId)
      if (!coord) throw new Error(`Malformed hex id: ${hexId}`)

      return db.transaction(async (tx) => {
        const current = await lockHexForUpdate(tx, coord)
        const next: HexTile = { ...current, ...updates }

        if (!next.ownerId) {
          // Reverted to open ground: delete rather than storing an ownerless row, or abandoned
          // tiles accumulate forever and erode the "only sold hexes are rows" invariant.
          await tx.query('DELETE FROM hexes WHERE q = $1 AND r = $2', [coord.q, coord.r])
          return unownedHexAt(coord)
        }

        await tx.query(
          `INSERT INTO hexes (q, r, owner_id, is_capital, last_price_paid_cents, is_contested, owned_since, locked_until)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (q, r) DO UPDATE SET
             owner_id = EXCLUDED.owner_id,
             is_capital = EXCLUDED.is_capital,
             last_price_paid_cents = EXCLUDED.last_price_paid_cents,
             is_contested = EXCLUDED.is_contested,
             owned_since = EXCLUDED.owned_since,
             locked_until = EXCLUDED.locked_until`,
          [
            coord.q,
            coord.r,
            next.ownerId,
            next.isCapital,
            next.lastPricePaidCents,
            next.isContested,
            next.ownedSince ?? new Date().toISOString(),
            next.lockedUntil,
          ],
        )

        return { ...next, id: hexIdFor(coord), coord }
      })
    },
  }
}

/**
 * Reads a hex and holds a row lock on it for the rest of the transaction.
 *
 * This is the single line the product's concurrency correctness rests on (ARCHITECTURE.md §8).
 * Two payments settling for the same hex in the same instant serialize here; the second reads the
 * price the first just committed rather than the stale one it was quoted.
 *
 * The unsold case needs care: `FOR UPDATE` locks rows, and there is no row to lock for a hex
 * nobody owns, so two simultaneous first-claims would both find nothing and both insert. The
 * `INSERT ... ON CONFLICT` in the caller is what resolves that — one insert wins, the other falls
 * through to the update path — so the pair together is safe even though the lock alone isn't.
 */
async function lockHexForUpdate(tx: SqlTransaction, coord: AxialCoord): Promise<HexTile> {
  const { rows } = await tx.query<HexRow>(
    `SELECT q, r, owner_id, is_capital, last_price_paid_cents, is_contested, owned_since, locked_until
       FROM hexes WHERE q = $1 AND r = $2
       FOR UPDATE`,
    [coord.q, coord.r],
  )
  const row = rows[0]
  return row ? rowToHexTile(row) : unownedHexAt(coord)
}

/** One bounded query for a set of coordinates. Never a scan — the key set comes from the caller. */
async function selectHexesAtCoords(
  db: Database,
  coords: AxialCoord[],
): Promise<Map<string, HexTile>> {
  const result = new Map<string, HexTile>()
  if (coords.length === 0) return result

  // `(q, r) IN ((..),(..))` over the composite primary key: an index lookup per pair, and the
  // planner can batch them. Parameterised rather than interpolated — these values are ultimately
  // caller-controlled, and string-building SQL here would be an injection point.
  const values = coords.map((_, index) => `($${index * 2 + 1}::int, $${index * 2 + 2}::int)`).join(', ')
  const params = coords.flatMap((coord) => [coord.q, coord.r])

  const { rows } = await db.query<HexRow>(
    `SELECT q, r, owner_id, is_capital, last_price_paid_cents, is_contested, owned_since, locked_until
       FROM hexes WHERE (q, r) IN (${values})`,
    params,
  )

  for (const row of rows) {
    const hex = rowToHexTile(row)
    result.set(hex.id, hex)
  }
  return result
}
