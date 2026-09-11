import { describe, expect, it } from 'vitest'
import { brandAskAnchor, type BrandAskState } from './brandAsk'
import { hexIdFor } from '@/lib/hex/hexIdentity'
import type { HexTile } from '@/types/game'

const RIVAL = 'orbitcache.io'

function owned(q: number, r: number): [string, HexTile] {
  const id = hexIdFor({ q, r })
  return [
    id,
    {
      id,
      coord: { q, r },
      ownerId: RIVAL,
      isCapital: false,
      lastPricePaidCents: 1_000,
      isContested: false,
      ownedSince: '2026-01-01T00:00:00.000Z',
      lockedUntil: null,
    },
  ]
}

/** A rival holds 1,0. Everything else on the map is open ground. */
const base: BrandAskState = {
  ownedHexes: new Map([owned(1, 0)]),
  selectedHexIds: [],
  hasBrand: false,
  askDismissed: false,
}

describe('brandAskAnchor', () => {
  it('appears on the first claim of open ground', () => {
    const id = hexIdFor({ q: 0, r: 0 })
    expect(brandAskAnchor({ ...base, selectedHexIds: [id] })).toBe(id)
  })

  it('does NOT appear before anything is selected', () => {
    // Nobody has shown intent yet — a form on arrival is the thing we are avoiding.
    expect(brandAskAnchor(base)).toBeNull()
  })

  it('does NOT appear on a tile somebody owns', () => {
    // Clicking occupied ground opens the owner's site, which is the click they paid for.
    // Interrupting it with a form would be taking back something we sold.
    expect(brandAskAnchor({ ...base, selectedHexIds: [hexIdFor({ q: 1, r: 0 })] })).toBeNull()
  })

  it('does NOT appear once a brand is known', () => {
    expect(
      brandAskAnchor({ ...base, selectedHexIds: [hexIdFor({ q: 0, r: 0 })], hasBrand: true }),
    ).toBeNull()
  })

  it('never returns after being dismissed', () => {
    // The "once" guarantee: closing it must not be undone by clicking more tiles.
    const dismissed = { ...base, askDismissed: true }
    expect(brandAskAnchor({ ...dismissed, selectedHexIds: [hexIdFor({ q: 0, r: 0 })] })).toBeNull()
    expect(
      brandAskAnchor({
        ...dismissed,
        selectedHexIds: [hexIdFor({ q: 0, r: 0 }), hexIdFor({ q: 2, r: 2 })],
      }),
    ).toBeNull()
  })

  it('anchors to the tile just clicked, not the first one ever clicked', () => {
    const first = hexIdFor({ q: 0, r: 0 })
    const latest = hexIdFor({ q: 3, r: -1 })
    expect(brandAskAnchor({ ...base, selectedHexIds: [first, latest] })).toBe(latest)
  })

  it('follows the selection when the newest pick is open ground', () => {
    const ids = [hexIdFor({ q: 0, r: 0 }), hexIdFor({ q: 0, r: 1 })]
    expect(brandAskAnchor({ ...base, selectedHexIds: ids })).toBe(ids[1])
  })

  it('hides itself if the newest pick is occupied, even mid-flow', () => {
    // Taking a rival tile through the arrow should not drag a form onto their territory.
    const ids = [hexIdFor({ q: 0, r: 0 }), hexIdFor({ q: 1, r: 0 })]
    expect(brandAskAnchor({ ...base, selectedHexIds: ids })).toBeNull()
  })

  it('ignores a malformed id instead of throwing', () => {
    expect(brandAskAnchor({ ...base, selectedHexIds: ['not-a-hex'] })).toBeNull()
  })

  it('works on a completely empty map', () => {
    const id = hexIdFor({ q: 9, r: -4 })
    expect(brandAskAnchor({ ...base, ownedHexes: new Map(), selectedHexIds: [id] })).toBe(id)
  })
})
