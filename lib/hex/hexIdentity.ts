import { BASE_HEX_PRICE_CENTS } from '@/lib/pricing/takeoverPricing'
import { axialKey, hexDistance, type AxialCoord } from './hexMath'
import type { HexTile } from '@/types/game'

const HEX_ID_PREFIX = 'hex_'
// Two integers separated by a comma, each optionally negative. Anchored, so nothing else parses.
const HEX_ID_PATTERN = /^hex_(-?\d+),(-?\d+)$/

/** The canonical id for a coordinate. The single place this format is defined. */
export function hexIdFor(coord: AxialCoord): string {
  return `${HEX_ID_PREFIX}${axialKey(coord)}`
}

/**
 * Recovers a coordinate from a hex id, or null if the id is malformed.
 *
 * This is what makes the map infinite: a coordinate is fully recoverable from its id, so an
 * unclaimed hex needs no stored row anywhere — the server can validate and price a hex it has
 * never seen before. Returns null rather than throwing because it runs on untrusted request
 * bodies, where a bad id is an expected 400 and not an exceptional condition.
 */
export function coordFromHexId(hexId: string): AxialCoord | null {
  const match = HEX_ID_PATTERN.exec(hexId)
  if (!match) return null

  const q = Number(match[1])
  const r = Number(match[2])
  // Number() on a digit string can still overflow into imprecision; a coordinate beyond safe
  // integer range is meaningless as a map position and must not be trusted for arithmetic.
  if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) return null

  return { q, r }
}

/**
 * The default state of a hex nobody has bought.
 *
 * Unclaimed hexes are *derived*, never stored. Persisting a row for every tile would mean writing
 * hundreds of thousands of identical placeholder rows to make the map bigger, and would cap the
 * map at whatever was pre-generated. Storing only what somebody actually paid for makes the grid
 * unbounded at zero storage cost, and makes "expand the map" a rendering decision rather than a
 * migration.
 */
export function unownedHexAt(coord: AxialCoord): HexTile {
  return {
    id: hexIdFor(coord),
    coord,
    ownerId: null,
    isCapital: false,
    lastPricePaidCents: BASE_HEX_PRICE_CENTS,
    isContested: false,
    ownedSince: null,
    lockedUntil: null,
  }
}

/** An owned hex if one exists, otherwise the derived unclaimed default. Never null. */
export function resolveHexAt(ownedHexes: ReadonlyMap<string, HexTile>, coord: AxialCoord): HexTile {
  return ownedHexes.get(hexIdFor(coord)) ?? unownedHexAt(coord)
}

/** As `resolveHexAt`, but from an id. Null only when the id itself is malformed. */
export function resolveHexById(ownedHexes: ReadonlyMap<string, HexTile>, hexId: string): HexTile | null {
  const owned = ownedHexes.get(hexId)
  if (owned) return owned
  const coord = coordFromHexId(hexId)
  return coord ? unownedHexAt(coord) : null
}

/**
 * The smallest ring count that keeps every claimed hex `buffer` rings clear of the map's edge.
 *
 * This is the growth rule: territory expanding toward the frontier pushes the frontier outward
 * ahead of it, so a player can always keep going and the map never has a wall to run into.
 */
export function requiredMapRadius(
  ownedCoords: Iterable<AxialCoord>,
  minRadius: number,
  buffer: number,
): number {
  const origin: AxialCoord = { q: 0, r: 0 }
  let radius = minRadius

  for (const coord of ownedCoords) {
    radius = Math.max(radius, hexDistance(origin, coord) + buffer)
  }

  return radius
}
