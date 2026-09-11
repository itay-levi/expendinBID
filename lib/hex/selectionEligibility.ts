import { checkHexEligibility, type EligibilityResult } from './territoryEligibility'
import { axialKey, hexNeighbors, type AxialCoord } from './hexMath'

/**
 * Stand-in empire id for a basket built by a visitor who doesn't have territory yet.
 *
 * `checkHexEligibility` can only ever answer "expansion" when it's told who is acquiring, and a
 * first-time buyer has no empire id until they pay. Without this, every tile after the first would
 * come back "blocked" — you could select one tile and nothing adjacent to it, which makes
 * multi-tile claims useless for exactly the people they're aimed at.
 */
export const PENDING_SELECTION_EMPIRE_ID = '__pending_selection__'

export type SelectionContext = {
  /** Coordinate keys already in the basket. */
  selectedKeys: ReadonlySet<string>
  /**
   * Who owns the target right now, or null for open ground. Required rather than derived: the
   * server backs `getOwnerAt` with a neighbours-only index that excludes the target, so deriving
   * it would silently report every takeover target as unowned.
   */
  targetOwnerId: string | null
}

/**
 * Territorial adjacency (ARCHITECTURE.md §23) evaluated against owned territory plus the basket.
 *
 * Scattering is ALLOWED. An earlier version forbade it — one capital, then grow — which did close
 * the loophole but closed it the wrong way: isolated tiles are genuinely valuable to a buyer, and
 * refusing the sale just turns demand away. The exploit was never that people wanted spread-out
 * ground, it was that spread-out ground cost the same as a compact block while delivering far more
 * visibility. That is a pricing bug, and it is fixed in pricing (see `priceForSelection`, which
 * charges a premium per separate billboard) rather than by a rule.
 *
 * What remains blocked is a tile buried inside a rival's contiguous territory with nothing of yours
 * touching it. That is the actual game: you fight to a border before you can take what is behind it.
 *
 * Still a preview when run on the client. The checkout endpoint re-derives all of it server-side
 * from the submitted URL and rejects anything that fails; nothing here is a trust boundary.
 */
export function checkSelectionEligibility(
  targetCoord: AxialCoord,
  getOwnerAt: (coord: AxialCoord) => string | null | undefined,
  acquiringEmpireId: string | null,
  context: SelectionContext,
): EligibilityResult {
  const effectiveEmpireId = acquiringEmpireId ?? PENDING_SELECTION_EMPIRE_ID

  return checkHexEligibility(
    targetCoord,
    (coord) => (context.selectedKeys.has(axialKey(coord)) ? effectiveEmpireId : getOwnerAt(coord)),
    effectiveEmpireId,
    context.targetOwnerId,
  )
}

/**
 * Splits coordinates into contiguous groups. Used to tell a buyer *which* part of their basket has
 * come adrift, rather than only that something has.
 */
export function countDisconnectedGroups(coords: AxialCoord[]): number {
  const remaining = new Set(coords.map(axialKey))
  const byKey = new Map(coords.map((coord) => [axialKey(coord), coord]))
  let groups = 0

  while (remaining.size > 0) {
    groups += 1
    const startKey = remaining.values().next().value as string
    const queue = [byKey.get(startKey) as AxialCoord]
    remaining.delete(startKey)

    while (queue.length > 0) {
      const current = queue.pop() as AxialCoord
      for (const neighbor of hexNeighbors(current)) {
        const key = axialKey(neighbor)
        if (!remaining.has(key)) continue
        remaining.delete(key)
        queue.push(byKey.get(key) as AxialCoord)
      }
    }
  }

  return groups
}
