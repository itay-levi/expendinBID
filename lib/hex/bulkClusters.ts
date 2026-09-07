import { generateHexagonGrid, axialKey, type AxialCoord } from './hexMath'

/**
 * All hexes within `radius` rings of `origin` — used by the "Mass Conquer" bulk-buy mode.
 * generateHexagonGrid already produces exactly a 7-hex (radius 1) or 19-hex (radius 2) cluster
 * around the world origin; this just re-centers that same shape on the buyer's chosen hex.
 */
export function hexesInRadius(origin: AxialCoord, radius: number): AxialCoord[] {
  return generateHexagonGrid(radius).map((offset) => ({
    q: origin.q + offset.q,
    r: origin.r + offset.r,
  }))
}

/** Cluster sizes that earn the bulk discount: a hex plus one ring (7), or plus two rings (19). */
const DISCOUNTABLE_SIZES = new Map<number, number>([
  [7, 1],
  [19, 2],
])

/**
 * Anti-abuse check for the "Mass Conquer" discount.
 *
 * The discount is priced as a bundle for taking a *contiguous* block of territory. Nothing in the
 * pricing function itself enforces that shape, so without this check a client could POST any 7 or
 * 19 individually-eligible hex ids — scattered anywhere across the map — and collect 10% off a set
 * that was never a cluster. This verifies the submitted coordinates are exactly the full ring set
 * around one of their own members, which is the only shape the UI can legitimately produce.
 */
export function isValidBulkCluster(coords: AxialCoord[]): boolean {
  const radius = DISCOUNTABLE_SIZES.get(coords.length)
  if (radius === undefined) return false

  const submitted = new Set(coords.map(axialKey))
  if (submitted.size !== coords.length) return false // duplicate ids padding the count

  return coords.some((candidateOrigin) => {
    const expected = hexesInRadius(candidateOrigin, radius)
    if (expected.length !== submitted.size) return false
    return expected.every((coord) => submitted.has(axialKey(coord)))
  })
}
