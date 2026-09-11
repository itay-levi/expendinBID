import { hexNeighbors, type AxialCoord } from './hexMath'

export type EligibilityReason = 'expansion' | 'frontier' | 'blocked' | 'disconnected'
export type EligibilityResult = { eligible: boolean; reason: EligibilityReason }

/**
 * Civilization-style territorial rule: a hex can only be targeted (bought or attacked) if it
 * borders territory the acquiring empire already controls, or if it sits in genuinely neutral
 * ground. A hex buried inside a rival's contiguous territory, touching nothing of yours, can't be
 * sniped directly; you have to fight to its border first, one adjacent hex at a time.
 *
 * "Buried" is the operative word, and it applies to OWNED tiles. Unclaimed ground that still
 * touches unclaimed ground is not behind anyone's lines and is sold to whoever wants it. Treating
 * every empty tile that merely *touched* an empire as unreachable sealed a one-tile moat around
 * each one — on a populated map that left the entire frontier unbuyable to a newcomer, who by
 * definition owns nothing to expand from, and the claim bar could not price a single tile they
 * were likely to click.
 *
 * `targetOwnerId` is passed in rather than read through `getOwnerAt` deliberately: callers back
 * that lookup with a neighbours-only index that does NOT contain the target itself, so deriving it
 * here would read every takeover target as unowned and let anyone snipe any tile on the map.
 *
 * `getOwnerAt` is a lookup rather than a Map so callers can back it with whatever shape their
 * hex storage actually uses (a Map keyed by axial coordinate, a Map keyed by a string hex id, a
 * database round-trip) without this function caring.
 */
export function checkHexEligibility(
  targetCoord: AxialCoord,
  getOwnerAt: (coord: AxialCoord) => string | null | undefined,
  acquiringEmpireId: string | null,
  targetOwnerId: string | null,
): EligibilityResult {
  const neighbors = hexNeighbors(targetCoord).map((coord) => getOwnerAt(coord) ?? null)
  const neighborOwners = neighbors.filter((ownerId): ownerId is string => ownerId !== null)

  if (acquiringEmpireId !== null && neighborOwners.includes(acquiringEmpireId)) {
    return { eligible: true, reason: 'expansion' }
  }

  if (neighborOwners.length === 0) {
    return { eligible: true, reason: 'frontier' }
  }

  // Open ground with a way in from open ground. Only a tile sealed on all six sides is genuinely
  // behind someone's lines; anything on the border of the occupied region is just the frontier.
  if (targetOwnerId === null && neighborOwners.length < neighbors.length) {
    return { eligible: true, reason: 'frontier' }
  }

  return { eligible: false, reason: 'blocked' }
}

export const ELIGIBILITY_MESSAGES: Record<EligibilityReason, string> = {
  expansion: 'Adjacent to your territory',
  frontier: 'Unclaimed frontier — open to a new capital',
  blocked: 'Not reachable — attack from a bordering tile first',
  disconnected: 'Must touch your territory — you only get one starting tile',
}
