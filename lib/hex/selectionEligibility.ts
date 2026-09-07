import { checkHexEligibility, type EligibilityResult } from './territoryEligibility'
import { axialKey, type AxialCoord } from './hexMath'

/**
 * Stand-in empire id for a basket built by a visitor who doesn't have territory yet.
 *
 * `checkHexEligibility` can only ever answer "expansion" when it's told who is acquiring, and a
 * first-time buyer has no empire id until they pay. Without this, every hex after the first would
 * come back "blocked" — you could select one tile and nothing adjacent to it, which makes
 * multi-select useless for exactly the people it's aimed at.
 */
export const PENDING_SELECTION_EMPIRE_ID = '__pending_selection__'

/**
 * Territorial adjacency (ARCHITECTURE.md §23) evaluated against owned territory *plus* whatever is
 * already in the basket.
 *
 * Hexes queued for purchase count as yours for reachability, because by the time the purchase
 * settles they will be. That is what lets a buyer trace a path outward — pick a border tile, then
 * the one beyond it — instead of being limited to tiles touching territory they own right now.
 *
 * Still a preview only. The checkout endpoint re-derives all of this server-side from the
 * submitted URL and rejects anything that fails; nothing here is a trust boundary.
 */
export function checkSelectionEligibility(
  targetCoord: AxialCoord,
  getOwnerAt: (coord: AxialCoord) => string | null | undefined,
  acquiringEmpireId: string | null,
  selectedKeys: ReadonlySet<string>,
): EligibilityResult {
  const effectiveEmpireId = acquiringEmpireId ?? PENDING_SELECTION_EMPIRE_ID

  return checkHexEligibility(
    targetCoord,
    (coord) => (selectedKeys.has(axialKey(coord)) ? effectiveEmpireId : getOwnerAt(coord)),
    effectiveEmpireId,
  )
}
