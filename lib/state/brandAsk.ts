import { resolveHexById } from '@/lib/hex/hexIdentity'
import type { HexTile } from '@/types/game'

export type BrandAskState = {
  /** Only tiles somebody owns — unclaimed ground is derived, never stored. */
  ownedHexes: ReadonlyMap<string, HexTile>
  /** Hex ids in the buyer's basket, in click order. */
  selectedHexIds: readonly string[]
  /** True once a brand has resolved from whatever is typed in the claim bar. */
  hasBrand: boolean
  /** Set when the buyer closes the card, or once they answer it. */
  askDismissed: boolean
}

/**
 * Whether to pin the "what's your website?" card to a tile, and which tile.
 *
 * Fires at most ONCE, on the buyer's first claim of open ground. Three properties make that the
 * right moment:
 *
 *  - **It cannot fire on somebody else's tile.** Clicking occupied ground opens the owner's site,
 *    which is the click they paid for; interrupting it with a form would be taking something we
 *    sold. Takeovers go through the attack arrow instead, and by then the buyer has a domain.
 *  - **It cannot fire before intent.** Selecting a tile is a deliberate act — nobody does it by
 *    accident — so the question arrives only after somebody has shown they want to buy.
 *  - **It cannot nag.** Once answered or dismissed it never returns; the claim bar carries the
 *    question from then on.
 *
 * Returns the hex id to anchor to, or null for "don't show". Keeping this a pure function over
 * plain state means the timing rule is testable, unlike the arrow gating that broke silently
 * inside a component.
 */
export function brandAskAnchor(state: BrandAskState): string | null {
  if (state.hasBrand || state.askDismissed) return null

  // The most recent pick — the card belongs on the tile the buyer just touched, not on the first
  // one they ever clicked.
  const latestId = state.selectedHexIds[state.selectedHexIds.length - 1]
  if (!latestId) return null

  const hex = resolveHexById(state.ownedHexes, latestId)
  if (!hex) return null

  // Open ground only. Occupied tiles are somebody's advertising space.
  return hex.ownerId === null ? latestId : null
}
