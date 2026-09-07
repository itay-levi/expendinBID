import { describe, expect, it } from 'vitest'
import { attackCandidates, computeAttackArrows } from './attackArrows'
import { axialKey, axialToPixel, type AxialCoord } from './hexMath'
import { hexesInRadius } from './bulkClusters'

const origin: AxialCoord = { q: 0, r: 0 }

function owners(entries: Array<[AxialCoord, string]>) {
  const byKey = new Map(entries.map(([coord, owner]) => [axialKey(coord), owner]))
  return (coord: AxialCoord) => byKey.get(axialKey(coord)) ?? null
}

const keys = (...coords: AxialCoord[]) => new Set(coords.map(axialKey))
const none = new Set<string>()

describe('computeAttackArrows', () => {
  it('offers an arrow into a rival tile touching your border', () => {
    const rival: AxialCoord = { q: 1, r: 0 }
    const arrows = computeAttackArrows([rival], {
      getOwnerAt: owners([[rival, 'rival.com']]),
      acquiringEmpireId: 'me.com',
      ownedKeys: keys(origin),
      selectedKeys: none,
    })
    expect(arrows).toHaveLength(1)
    expect(arrows[0]?.to).toEqual(rival)
    expect(arrows[0]?.from).toEqual(origin)
  })

  it('offers NO arrow on open ground', () => {
    // The rule the whole design rests on: an empty tile can only mean "claim", so there is nothing
    // to disambiguate and an arrow there would be interface for a decision nobody has to make.
    const arrows = computeAttackArrows([{ q: 1, r: 0 }], {
      getOwnerAt: owners([]),
      acquiringEmpireId: 'me.com',
      ownedKeys: keys(origin),
      selectedKeys: none,
    })
    expect(arrows).toEqual([])
  })

  it('offers no arrow on your own territory', () => {
    const mine: AxialCoord = { q: 1, r: 0 }
    const arrows = computeAttackArrows([mine], {
      getOwnerAt: owners([[mine, 'me.com']]),
      acquiringEmpireId: 'me.com',
      ownedKeys: keys(origin, mine),
      selectedKeys: none,
    })
    expect(arrows).toEqual([])
  })

  it('offers no arrow on a rival tile you cannot reach', () => {
    const far: AxialCoord = { q: 9, r: 9 }
    const arrows = computeAttackArrows([far], {
      getOwnerAt: owners([[far, 'rival.com']]),
      acquiringEmpireId: 'me.com',
      ownedKeys: keys(origin),
      selectedKeys: none,
    })
    expect(arrows).toEqual([])
  })

  it('lets a pending basket tile serve as the attack platform', () => {
    // You should be able to select a border tile and attack through it in one transaction.
    const rival: AxialCoord = { q: 2, r: 0 }
    const arrows = computeAttackArrows([rival], {
      getOwnerAt: owners([[rival, 'rival.com']]),
      acquiringEmpireId: null,
      ownedKeys: none,
      selectedKeys: keys({ q: 1, r: 0 }),
    })
    expect(arrows).toHaveLength(1)
    expect(arrows[0]?.from).toEqual({ q: 1, r: 0 })
  })

  it('skips a rival tile already in the basket', () => {
    const rival: AxialCoord = { q: 1, r: 0 }
    const arrows = computeAttackArrows([rival], {
      getOwnerAt: owners([[rival, 'rival.com']]),
      acquiringEmpireId: 'me.com',
      ownedKeys: keys(origin),
      selectedKeys: keys(rival),
    })
    expect(arrows).toEqual([])
  })

  it('draws ONE arrow per target, even when surrounded', () => {
    // A rival tile ringed by the attacker borders six of their tiles. Six stacked arrows on one
    // hex would be unreadable.
    const rival = origin
    const ring = hexesInRadius(origin, 1).filter((coord) => !(coord.q === 0 && coord.r === 0))
    const arrows = computeAttackArrows([rival], {
      getOwnerAt: owners([[rival, 'rival.com']]),
      acquiringEmpireId: 'me.com',
      ownedKeys: keys(...ring),
      selectedKeys: none,
    })
    expect(arrows).toHaveLength(1)
  })

  it('places the arrow on the shared edge, halfway between the two tiles', () => {
    const rival: AxialCoord = { q: 1, r: 0 }
    const arrow = computeAttackArrows([rival], {
      getOwnerAt: owners([[rival, 'rival.com']]),
      acquiringEmpireId: 'me.com',
      ownedKeys: keys(origin),
      selectedKeys: none,
    })[0]

    const a = axialToPixel(origin, 1)
    const b = axialToPixel(rival, 1)
    expect(arrow?.x).toBeCloseTo((a.x + b.x) / 2, 10)
    expect(arrow?.z).toBeCloseTo((a.z + b.z) / 2, 10)
  })

  it('points the arrow from your tile INTO theirs, in every direction', () => {
    // Direction is the whole point — the arrow says "attack from here", so a reversed angle would
    // read as the rival attacking you.
    for (const rival of hexesInRadius(origin, 1).filter((c) => !(c.q === 0 && c.r === 0))) {
      const arrow = computeAttackArrows([rival], {
        getOwnerAt: owners([[rival, 'rival.com']]),
        acquiringEmpireId: 'me.com',
        ownedKeys: keys(origin),
        selectedKeys: none,
      })[0]

      const target = axialToPixel(rival, 1)
      const expected = Math.atan2(target.z, target.x)
      expect(Math.cos((arrow?.angle ?? 0) - expected)).toBeCloseTo(1, 6)
    }
  })

  it('handles a buyer with no territory and nothing selected', () => {
    expect(
      computeAttackArrows([{ q: 1, r: 0 }], {
        getOwnerAt: owners([[{ q: 1, r: 0 }, 'rival.com']]),
        acquiringEmpireId: null,
        ownedKeys: none,
        selectedKeys: none,
      }),
    ).toEqual([])
  })
})

describe('attackCandidates', () => {
  const coordFromKey = (key: string) => {
    const [q, r] = key.split(',').map(Number)
    return q === undefined || r === undefined || Number.isNaN(q) || Number.isNaN(r) ? null : { q, r }
  }

  it('returns the ring just outside your territory', () => {
    expect(attackCandidates(keys(origin), none, coordFromKey)).toHaveLength(6)
  })

  it('never includes ground you already hold or have selected', () => {
    const held = hexesInRadius(origin, 1)
    const candidates = attackCandidates(keys(...held), none, coordFromKey)
    for (const candidate of candidates) {
      expect(held.some((c) => c.q === candidate.q && c.r === candidate.r)).toBe(false)
    }
  })

  it('deduplicates tiles bordering several of your own', () => {
    const candidates = attackCandidates(keys(origin, { q: 1, r: 0 }), none, coordFromKey)
    expect(new Set(candidates.map(axialKey)).size).toBe(candidates.length)
  })

  it('scales with YOUR border, not with the size of the map', () => {
    // The property that keeps arrow count bounded: a small empire sees a handful of candidates
    // however many rival tiles exist in the world.
    expect(attackCandidates(keys(origin), none, coordFromKey).length).toBe(6)
    expect(attackCandidates(keys(...hexesInRadius(origin, 1)), none, coordFromKey).length).toBe(12)
  })

  it('handles empty input and malformed keys', () => {
    expect(attackCandidates(none, none, coordFromKey)).toEqual([])
    expect(attackCandidates(new Set(['junk']), none, coordFromKey)).toEqual([])
  })
})
