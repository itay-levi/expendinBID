import { hexNeighbors, type AxialCoord } from './hexMath'

export type EligibilityReason = 'expansion' | 'frontier' | 'blocked' | 'disconnected'
export type EligibilityResult = { eligible: boolean; reason: EligibilityReason }

/**
 * Civilization-style territorial rule: a hex can only be targeted (bought or attacked) if it
 * borders territory the acquiring empire already controls, or if it sits in genuinely neutral
 * ground — no owner touching any of its six neighbors. A hex buried inside a rival's contiguous
 * territory, touching nothing of yours, can't be sniped directly; you have to fight to its
 * border first, one adjacent hex at a time.
 *
 * `getOwnerAt` is a lookup rather than a Map so callers can back it with whatever shape their
 * hex storage actually uses (a Map keyed by axial coordinate, a Map keyed by a string hex id, a
 * database round-trip) without this function caring.
 */
export function checkHexEligibility(
  targetCoord: AxialCoord,
  getOwnerAt: (coord: AxialCoord) => string | null | undefined,
  acquiringEmpireId: string | null,
): EligibilityResult {
  const neighborOwners = hexNeighbors(targetCoord)
    .map((coord) => getOwnerAt(coord) ?? null)
    .filter((ownerId): ownerId is string => ownerId !== null)

  if (acquiringEmpireId !== null && neighborOwners.includes(acquiringEmpireId)) {
    return { eligible: true, reason: 'expansion' }
  }

  if (neighborOwners.length === 0) {
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
