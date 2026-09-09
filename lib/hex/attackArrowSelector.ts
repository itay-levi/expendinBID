import { attackCandidates, computeAttackArrows, type AttackArrow } from './attackArrows'
import { coordFromHexId } from './hexIdentity'
import { axialKey, type AxialCoord } from './hexMath'
import type { HexTile } from '@/types/game'

export type ArrowSelectorState = {
  /** Only tiles somebody owns — unclaimed ground is derived, never stored. */
  ownedHexes: ReadonlyMap<string, HexTile>
  /** Hex ids currently in the buyer's basket. */
  selectedHexIds: readonly string[]
  /** Set after a completed claim; null on a fresh page load. */
  myEmpireId: string | null
  /** Hostname resolved from whatever is typed in the claim bar. */
  pendingDomain: string | null
}

/**
 * Who the map should treat as "you".
 *
 * `myEmpireId` is only set after a completed claim and does not survive a reload, so a returning
 * buyer stopped being recognised as the owner of their own territory — which left them with no
 * border, and every arrow disappeared. The domain typed into the claim bar is the SAME identity the
 * server derives (empireRepository keys on hostname), so typing it is enough to be recognised.
 *
 * Never a trust boundary: the server re-derives identity from the submitted URL on every request
 * and never reads this value.
 */
export function resolveActingEmpireId(state: ArrowSelectorState): string | null {
  return state.myEmpireId ?? state.pendingDomain ?? null
}

/**
 * Every attack arrow that should currently be on screen.
 *
 * Pulled out of the React component on purpose. This gating is where arrows went missing — the
 * component could stop producing them for a reason no test could see, because the logic only ran
 * inside a renderer. As a plain function over plain state it can be checked directly, including
 * the reload case that actually broke.
 */
export function selectAttackArrows(state: ArrowSelectorState): AttackArrow[] {
  const actingEmpireId = resolveActingEmpireId(state)
  if (!actingEmpireId) return [] // nobody to attack as: a visitor with no URL entered is browsing

  const selectedKeys = new Set(
    state.selectedHexIds
      .map(coordFromHexId)
      .filter((coord): coord is AxialCoord => coord !== null)
      .map(axialKey),
  )

  const ownedKeys = new Set<string>()
  for (const hex of state.ownedHexes.values()) {
    if (hex.ownerId === actingEmpireId) ownedKeys.add(axialKey(hex.coord))
  }

  // No border and nothing selected means nowhere to attack FROM. This is the newcomer case: a
  // company holding nothing cannot take its first tile from a full centre. Solving that needs a
  // landing mechanic, which is a separate product decision.
  if (ownedKeys.size === 0 && selectedKeys.size === 0) return []

  const candidates = attackCandidates(ownedKeys, selectedKeys, coordFromKey)

  return computeAttackArrows(candidates, {
    getOwnerAt: (coord) => state.ownedHexes.get(`hex_${axialKey(coord)}`)?.ownerId ?? null,
    acquiringEmpireId: actingEmpireId,
    ownedKeys,
    selectedKeys,
  })
}

/** Parses the `q,r` coordinate keys `attackCandidates` works in. */
function coordFromKey(key: string): AxialCoord | null {
  const [q, r] = key.split(',').map(Number)
  if (q === undefined || r === undefined || !Number.isFinite(q) || !Number.isFinite(r)) return null
  return { q, r }
}
