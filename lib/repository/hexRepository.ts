import { hexIdFor, resolveHexById, unownedHexAt } from '@/lib/hex/hexIdentity'
import { hexNeighbors, type AxialCoord } from '@/lib/hex/hexMath'
import { buildDemoSeed } from '@/lib/demo/seedDemoState'
import type { HexTile } from '@/types/game'

/**
 * The Repository pattern from the project's coding standards: business logic (the checkout and
 * webhook handlers) depends on this interface, not on a specific database. The exported
 * implementation here is in-memory — correct for local dev, NOT what runs in production. A
 * Postgres implementation (see db/migrations/0001_init.sql, and the row-level locking in
 * ARCHITECTURE.md §8) satisfies this same interface, and nothing above this file changes.
 *
 * Every method is shaped to be an indexed point lookup or a bounded range query. There is
 * deliberately no "fetch the whole map" operation: the map is unbounded, so any full scan is a
 * query whose cost grows without limit, and at the traffic this is meant to carry that is the
 * difference between a primary-key hit and a sequential scan of every hex ever sold.
 */
export type HexRepository = {
  /** Never null for a well-formed id: an unsold hex is derived, not stored. */
  getHexById(hexId: string): Promise<HexTile | null>
  /** Batched point lookup. One round trip for a whole basket, not one per hex. */
  getHexesByIds(hexIds: string[]): Promise<Map<string, HexTile>>
  /**
   * Owners of the six neighbours of each given coordinate — everything the adjacency rule needs.
   * Replaces a full-map read with a bounded lookup of at most `6 * coords.length` keys.
   */
  getNeighborOwners(coords: AxialCoord[]): Promise<Map<string, string>>
  /**
   * Sold hexes whose coordinates fall inside a bounding box — the map read the renderer performs.
   *
   * A bounding box rather than "everything" is the whole point: the map is unbounded, so the only
   * question that has a bounded answer is "what is on screen". Backed by the (q, r) composite
   * index, so this is an index range scan whose cost tracks the viewport, not total sales.
   */
  getOwnedHexesInRange(bounds: HexBounds): Promise<HexTile[]>
  /** Must run inside a row-locked transaction in a real implementation — see ARCHITECTURE.md §8. */
  applyTakeover(hexId: string, updates: Partial<HexTile>): Promise<HexTile>
  /** Whether an empire holds any tile at all — gates the one free placement (§23). */
  hasAnyTerritory(empireId: string): Promise<boolean>
  /** Appends to the immutable takeover ledger that feeds the ticker and the market stats. */
  recordTakeover(entry: TakeoverRecord): Promise<void>
}

export type HexBounds = { minQ: number; maxQ: number; minR: number; maxR: number }

export type TakeoverRecord = {
  coord: AxialCoord
  attackerEmpireId: string
  defenderEmpireId: string | null
  pricePaidCents: number
}

/**
 * Only sold hexes are stored, mirroring the Postgres schema. Seeded from the same demo data the
 * client renders so a hex the user can see and click also exists server-side.
 */
const memoryStore = new Map<string, HexTile>(
  buildDemoSeed()
    .hexes.filter((hex) => hex.ownerId !== null)
    .map((hex) => [hex.id, hex]),
)

export const inMemoryHexRepository: HexRepository = {
  async getHexById(hexId) {
    return resolveHexById(memoryStore, hexId)
  },

  async getHexesByIds(hexIds) {
    const result = new Map<string, HexTile>()
    for (const hexId of hexIds) {
      const hex = resolveHexById(memoryStore, hexId)
      if (hex) result.set(hexId, hex)
    }
    return result
  },

  async getNeighborOwners(coords) {
    const owners = new Map<string, string>()
    for (const coord of coords) {
      for (const neighbor of hexNeighbors(coord)) {
        const id = hexIdFor(neighbor)
        const ownerId = memoryStore.get(id)?.ownerId
        if (ownerId) owners.set(id, ownerId)
      }
    }
    return owners
  },

  async getOwnedHexesInRange(bounds) {
    return Array.from(memoryStore.values()).filter(
      (hex) =>
        hex.coord.q >= bounds.minQ &&
        hex.coord.q <= bounds.maxQ &&
        hex.coord.r >= bounds.minR &&
        hex.coord.r <= bounds.maxR,
    )
  },

  async applyTakeover(hexId, updates) {
    const existing = resolveHexById(memoryStore, hexId)
    if (!existing) throw new Error(`Malformed hex id: ${hexId}`)
    const updated: HexTile = { ...existing, ...updates }
    if (updated.ownerId) memoryStore.set(hexId, updated)
    else memoryStore.delete(hexId)
    return updated
  },

  async hasAnyTerritory(empireId) {
    for (const hex of memoryStore.values()) {
      if (hex.ownerId === empireId) return true
    }
    return false
  },

  async recordTakeover() {
    // No ledger in the in-memory implementation — it exists for local dev without a database,
    // where nothing reads history back.
  },
}

/** Test seam: lets a test start from a known map without reaching into module state. */
export function __resetInMemoryHexes(hexes: HexTile[] = []): void {
  memoryStore.clear()
  for (const hex of hexes) {
    if (hex.ownerId !== null) memoryStore.set(hex.id, hex)
  }
}

export { unownedHexAt }

// Swap this export for the Postgres implementation when a database is wired up.
export const hexRepository: HexRepository = inMemoryHexRepository
