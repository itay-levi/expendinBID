import { describe, expect, it } from 'vitest'
import { resolveActingEmpireId, selectAttackArrows, type ArrowSelectorState } from './attackArrowSelector'
import { hexIdFor } from './hexIdentity'
import { axialKey, type AxialCoord } from './hexMath'
import type { HexTile } from '@/types/game'

const ME = 'outrank.so'
const RIVAL = 'orbitcache.io'

function tile(coord: AxialCoord, ownerId: string): HexTile {
  return {
    id: hexIdFor(coord),
    coord,
    ownerId,
    isCapital: false,
    lastPricePaidCents: 1_000,
    isContested: false,
    ownedSince: '2026-01-01T00:00:00.000Z',
    lockedUntil: null,
  }
}

function mapOf(...tiles: HexTile[]): Map<string, HexTile> {
  return new Map(tiles.map((hex) => [hex.id, hex]))
}

/** My territory at the origin, a rival directly east of it — one attack should be available. */
const BORDER = mapOf(tile({ q: 0, r: 0 }, ME), tile({ q: 1, r: 0 }, RIVAL))

const base: ArrowSelectorState = {
  ownedHexes: BORDER,
  selectedHexIds: [],
  pendingDomain: ME,
}

describe('selectAttackArrows', () => {
  it('offers an arrow into the rival tile on my border', () => {
    const arrows = selectAttackArrows(base)
    expect(arrows).toHaveLength(1)
    expect(arrows[0]?.to).toEqual({ q: 1, r: 0 })
    expect(arrows[0]?.from).toEqual({ q: 0, r: 0 })
  })

  it('STILL offers it after a reload, when the cached empire id is gone', () => {
    // The regression this file exists for. The cached id does not survive a page reload, so a
    // returning buyer stopped being recognised as the owner of their own tiles — no border, no
    // arrows, and the map looked broken. The domain in the claim bar identifies them instead.
    const afterReload: ArrowSelectorState = { ...base, pendingDomain: ME }
    const arrows = selectAttackArrows(afterReload)
    expect(arrows).toHaveLength(1)
    expect(arrows[0]?.to).toEqual({ q: 1, r: 0 })
  })

  it('shows nothing to a visitor who has typed no URL', () => {
    // Browsing, not buying: assault markers would be noise.
    expect(selectAttackArrows({ ...base, pendingDomain: null })).toEqual([])
  })

  it('shows nothing once the bar is cleared, even to someone who already owns territory', () => {
    // The reported bug. A completed claim used to leave an id cached in the store for the rest of
    // the session, and gating on it painted an arrow on every tile bordering that territory while
    // the Pay button still read "Enter your site" — inviting an action checkout would refuse.
    expect(selectAttackArrows({ ...base, pendingDomain: null })).toEqual([])
  })

  it('lets a brand-new buyer attack through a tile they only just selected', () => {
    const newcomer: ArrowSelectorState = {
      ownedHexes: mapOf(tile({ q: 1, r: 0 }, RIVAL)),
      selectedHexIds: [hexIdFor({ q: 0, r: 0 })],
      pendingDomain: ME,
    }
    const arrows = selectAttackArrows(newcomer)
    expect(arrows).toHaveLength(1)
    expect(arrows[0]?.from).toEqual({ q: 0, r: 0 })
  })

  it('shows nothing when a newcomer holds and has selected nothing', () => {
    // Documented gap, not a bug: with no border there is nowhere to attack FROM. Taking a first
    // tile out of a full centre needs a landing mechanic, which is a separate decision.
    expect(
      selectAttackArrows({
        ownedHexes: mapOf(tile({ q: 1, r: 0 }, RIVAL)),
        selectedHexIds: [],
        pendingDomain: ME,
      }),
    ).toEqual([])
  })

  it('never offers an arrow onto my own ground', () => {
    const allMine = mapOf(tile({ q: 0, r: 0 }, ME), tile({ q: 1, r: 0 }, ME))
    expect(selectAttackArrows({ ...base, ownedHexes: allMine })).toEqual([])
  })

  it('never offers an arrow onto empty ground', () => {
    // Clicking an unclaimed tile can only mean "claim", so there is nothing to disambiguate.
    const justMe = mapOf(tile({ q: 0, r: 0 }, ME))
    expect(selectAttackArrows({ ...base, ownedHexes: justMe })).toEqual([])
  })

  it('drops the arrow once the rival tile is already in my basket', () => {
    const withRivalSelected: ArrowSelectorState = {
      ...base,
      selectedHexIds: [hexIdFor({ q: 1, r: 0 })],
    }
    expect(selectAttackArrows(withRivalSelected)).toEqual([])
  })

  it('offers one arrow per rival tile along a long border', () => {
    const owned = mapOf(
      tile({ q: 0, r: 0 }, ME),
      tile({ q: 0, r: 1 }, ME),
      tile({ q: 1, r: 0 }, RIVAL),
      tile({ q: 1, r: 1 }, RIVAL),
    )
    const arrows = selectAttackArrows({ ...base, ownedHexes: owned })
    expect(arrows).toHaveLength(2)
    expect(new Set(arrows.map((a) => axialKey(a.to))).size).toBe(2)
  })

  it('ignores a malformed id in the basket instead of throwing', () => {
    expect(() =>
      selectAttackArrows({ ...base, selectedHexIds: ['not-a-hex', hexIdFor({ q: 0, r: 0 })] }),
    ).not.toThrow()
  })

  it('gives every arrow a finite position and heading', () => {
    // A NaN here would silently place the mesh nowhere, which looks exactly like "no arrow".
    for (const arrow of selectAttackArrows(base)) {
      expect(Number.isFinite(arrow.x)).toBe(true)
      expect(Number.isFinite(arrow.z)).toBe(true)
      expect(Number.isFinite(arrow.angle)).toBe(true)
    }
  })
})

describe('resolveActingEmpireId', () => {
  it('is whoever the claim bar currently names', () => {
    expect(resolveActingEmpireId({ ...base, pendingDomain: 'other.com' })).toBe('other.com')
  })

  it('is null when the bar is empty, so no arrow can be attributed to a past purchase', () => {
    expect(resolveActingEmpireId({ ...base, pendingDomain: null })).toBeNull()
  })
})
