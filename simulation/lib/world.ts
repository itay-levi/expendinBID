import { hexIdFor, resolveHexById, unownedHexAt } from '@/lib/hex/hexIdentity'
import { axialKey, hexDistance, hexNeighbors, type AxialCoord } from '@/lib/hex/hexMath'
import { isHexLocked } from '@/lib/pricing/takeoverPricing'
import type { Empire, HexTile, MarketSnapshot } from '@/types/game'
import type { SimHttp, SimResponse } from './http'
import type { Rng } from './rng'

/** Simulated activity stays within this many rings of the centre — inside what the UI shows. */
export const PLAY_RADIUS = 26
/** Window read from /api/map: covers the play area with a margin. */
const READ_WINDOW = 40
const ORIGIN: AxialCoord = { q: 0, r: 0 }

export type MapPayload = {
  success?: boolean
  error?: string
  data?: { hexes: HexTile[]; empires: Empire[]; market: MarketSnapshot }
}

/**
 * The map as a visitor's browser would see it right now — built from the same /api/map response
 * the UI polls, and read through the app's own hex helpers so both agree on what a tile is.
 */
export class World {
  private constructor(
    readonly hexes: ReadonlyMap<string, HexTile>,
    readonly empires: ReadonlyMap<string, Empire>,
    readonly market: MarketSnapshot | null,
  ) {}

  static async load(http: SimHttp, ip: string): Promise<{ world: World | null; response: SimResponse<MapPayload> }> {
    const response = await http.send<MapPayload>({
      method: 'GET',
      path: `/api/map?minQ=${-READ_WINDOW}&maxQ=${READ_WINDOW}&minR=${-READ_WINDOW}&maxR=${READ_WINDOW}`,
      endpoint: 'GET /api/map',
      ip,
    })
    const data = response.status === 200 && response.json?.success ? response.json.data : undefined
    if (!data) return { world: null, response }
    return {
      world: new World(
        new Map(data.hexes.map((hex) => [hex.id, hex])),
        new Map(data.empires.map((empire) => [empire.id, empire])),
        data.market,
      ),
      response,
    }
  }

  tile(hexId: string): HexTile {
    const hex = resolveHexById(this.hexes, hexId)
    if (!hex) throw new Error(`The simulator produced a malformed hex id: ${hexId}`)
    return hex
  }

  tileAt(coord: AxialCoord): HexTile {
    return this.hexes.get(hexIdFor(coord)) ?? unownedHexAt(coord)
  }

  ownerAt(coord: AxialCoord): string | null {
    return this.hexes.get(hexIdFor(coord))?.ownerId ?? null
  }

  isOpen(coord: AxialCoord): boolean {
    return this.ownerAt(coord) === null
  }

  inPlay(coord: AxialCoord): boolean {
    return hexDistance(coord, ORIGIN) <= PLAY_RADIUS
  }

  tilesOf(owner: string): HexTile[] {
    return [...this.hexes.values()].filter((hex) => hex.ownerId === owner)
  }

  /** Open ground whose six neighbours are open too — somewhere to plant a fresh block. */
  openSpot(rng: Rng, radius: number): AxialCoord | null {
    const reach = Math.max(1, Math.min(radius, PLAY_RADIUS))
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const q = rng.int(-reach, reach)
      const r = rng.int(Math.max(-reach, -q - reach), Math.min(reach, -q + reach))
      const coord = { q, r }
      if (this.isOpen(coord) && hexNeighbors(coord).every((neighbor) => this.isOpen(neighbor))) return coord
    }
    return null
  }

  /** Up to `size` connected open tiles grown outward from `start`; each added tile touches an earlier one. */
  cluster(start: AxialCoord, size: number, rng: Rng): AxialCoord[] {
    if (!this.isOpen(start) || !this.inPlay(start)) return []
    const picked = new Map<string, AxialCoord>([[axialKey(start), start]])
    const frontier: AxialCoord[] = [start]
    while (picked.size < size && frontier.length > 0) {
      const from = frontier.splice(rng.int(0, frontier.length - 1), 1)[0] as AxialCoord
      for (const next of rng.shuffle(hexNeighbors(from))) {
        if (picked.size >= size) break
        const key = axialKey(next)
        if (picked.has(key) || !this.isOpen(next) || !this.inPlay(next)) continue
        picked.set(key, next)
        frontier.push(next)
      }
    }
    return [...picked.values()]
  }

  /** Open tiles touching this owner's territory. */
  frontierOf(owner: string): AxialCoord[] {
    const open = new Map<string, AxialCoord>()
    for (const tile of this.tilesOf(owner)) {
      for (const neighbor of hexNeighbors(tile.coord)) {
        if (this.isOpen(neighbor) && this.inPlay(neighbor)) open.set(axialKey(neighbor), neighbor)
      }
    }
    return [...open.values()]
  }

  /** Rival tiles on this owner's border that are not protected — what an attack arrow would point at. */
  rivalBorderOf(owner: string, now: Date): HexTile[] {
    const found = new Map<string, HexTile>()
    for (const tile of this.tilesOf(owner)) {
      for (const neighbor of hexNeighbors(tile.coord)) {
        const hex = this.hexes.get(hexIdFor(neighbor))
        if (hex && hex.ownerId && hex.ownerId !== owner && !isHexLocked(hex, now)) found.set(hex.id, hex)
      }
    }
    return [...found.values()]
  }

  lockedTiles(now: Date): HexTile[] {
    return [...this.hexes.values()].filter((hex) => hex.ownerId !== null && isHexLocked(hex, now))
  }

  /** Tiles surrounded on all six sides by their own owner — deep behind the lines. */
  interiorTiles(): HexTile[] {
    return [...this.hexes.values()].filter(
      (hex) => hex.ownerId !== null && hexNeighbors(hex.coord).every((neighbor) => this.ownerAt(neighbor) === hex.ownerId),
    )
  }

  ownerCounts(): Map<string, number> {
    const counts = new Map<string, number>()
    for (const hex of this.hexes.values()) {
      if (hex.ownerId) counts.set(hex.ownerId, (counts.get(hex.ownerId) ?? 0) + 1)
    }
    return counts
  }
}
