import { describe, expect, it } from 'vitest'
import { buildOwnerLookup, fingerprintHex, fingerprintHexes, verifyTakeoverStillValid } from './takeoverGuard'
import type { HexTile } from '@/types/game'

function hex(overrides: Partial<HexTile> & { q: number; r: number }): HexTile {
  const { q, r, ...rest } = overrides
  return {
    id: `hex_${q},${r}`,
    coord: { q, r },
    ownerId: null,
    isCapital: false,
    lastPricePaidCents: 0,
    isContested: false,
    ownedSince: null,
    lockedUntil: null,
    ...rest,
  }
}

const noNeighbours = () => null // every neighbour unclaimed => 'frontier' eligibility

describe('verifyTakeoverStillValid (double-spend / stale-state guard)', () => {
  it('accepts when nothing changed between checkout and settlement', () => {
    const target = hex({ q: 0, r: 0 })
    const result = verifyTakeoverStillValid({
      hex: target,
      expected: fingerprintHex(target),
      acquiringEmpireId: 'attacker.com',
      ownerAt: noNeighbours,
    })
    expect(result).toEqual({ ok: true })
  })

  it('REJECTS when a faster payment took the hex first', () => {
    const atCheckout = hex({ q: 0, r: 0, ownerId: null })
    const atSettlement = hex({ q: 0, r: 0, ownerId: 'someone-else.com', lastPricePaidCents: 1000 })

    const result = verifyTakeoverStillValid({
      hex: atSettlement,
      expected: fingerprintHex(atCheckout),
      acquiringEmpireId: 'attacker.com',
      ownerAt: noNeighbours,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/changed hands/)
  })

  it('REJECTS when the price escalated while the payment was in flight', () => {
    const atCheckout = hex({ q: 1, r: 0, ownerId: 'rival.com', lastPricePaidCents: 1000 })
    const atSettlement = hex({ q: 1, r: 0, ownerId: 'rival.com', lastPricePaidCents: 1500 })

    const result = verifyTakeoverStillValid({
      hex: atSettlement,
      expected: fingerprintHex(atCheckout),
      acquiringEmpireId: 'attacker.com',
      ownerAt: noNeighbours,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/price changed/)
  })

  it('REJECTS when the defender bought protection in the meantime', () => {
    const atCheckout = hex({ q: 2, r: 0, ownerId: 'rival.com', lastPricePaidCents: 1000 })
    const atSettlement = hex({
      q: 2,
      r: 0,
      ownerId: 'rival.com',
      lastPricePaidCents: 1000,
      lockedUntil: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })

    const result = verifyTakeoverStillValid({
      hex: atSettlement,
      expected: fingerprintHex(atCheckout),
      acquiringEmpireId: 'attacker.com',
      ownerAt: noNeighbours,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/protected/)
  })

  it('accepts once a lapsed protection has expired', () => {
    const target = hex({
      q: 2,
      r: 0,
      ownerId: 'rival.com',
      lastPricePaidCents: 1000,
      lockedUntil: new Date(Date.now() - 1000).toISOString(),
    })
    const result = verifyTakeoverStillValid({
      hex: target,
      expected: fingerprintHex(target),
      acquiringEmpireId: 'attacker.com',
      ownerAt: noNeighbours,
    })
    expect(result.ok).toBe(true)
  })

  it('REJECTS when adjacency no longer holds at settlement time', () => {
    // A DEFENDED tile: reaching it is the whole point of the adjacency rule. Open ground beside a
    // rival is frontier and stays purchasable, so an unowned target here would prove nothing.
    const target = hex({ q: 0, r: 0, ownerId: 'defender.com', lastPricePaidCents: 1000 })
    // A rival borders the target and the attacker owns nothing adjacent => blocked.
    const ownerAt = buildOwnerLookup(new Map([['hex_1,0', 'rival.com']]))

    const result = verifyTakeoverStillValid({
      hex: target,
      expected: fingerprintHex(target),
      acquiringEmpireId: 'attacker.com',
      ownerAt,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/not reachable/i)
  })

  it('still settles open ground that merely borders a rival', () => {
    const target = hex({ q: 0, r: 0 })
    const ownerAt = buildOwnerLookup(new Map([['hex_1,0', 'rival.com']]))

    const result = verifyTakeoverStillValid({
      hex: target,
      expected: fingerprintHex(target),
      acquiringEmpireId: 'attacker.com',
      ownerAt,
    })
    expect(result).toEqual({ ok: true })
  })

  it('REJECTS when the webhook carries no pre-payment fingerprint at all', () => {
    const target = hex({ q: 0, r: 0 })
    const result = verifyTakeoverStillValid({
      hex: target,
      expected: undefined,
      acquiringEmpireId: 'attacker.com',
      ownerAt: noNeighbours,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/No recorded pre-payment state/)
  })

  it('REJECTS a fingerprint belonging to a different hex', () => {
    const target = hex({ q: 0, r: 0 })
    const other = hex({ q: 4, r: 4 })
    const result = verifyTakeoverStillValid({
      hex: target,
      expected: fingerprintHex(other),
      acquiringEmpireId: 'attacker.com',
      ownerAt: noNeighbours,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/mismatch/)
  })
})

describe('fingerprintHexes / buildOwnerLookup', () => {
  it('captures one fingerprint per hex', () => {
    const hexes = [hex({ q: 0, r: 0 }), hex({ q: 1, r: 0, ownerId: 'a.com', lastPricePaidCents: 500 })]
    expect(fingerprintHexes(hexes)).toEqual([
      { hexId: 'hex_0,0', ownerId: null, lastPricePaidCents: 0 },
      { hexId: 'hex_1,0', ownerId: 'a.com', lastPricePaidCents: 500 },
    ])
  })

  it('resolves owners by coordinate and null for open ground', () => {
    const lookup = buildOwnerLookup(new Map([['hex_3,3', 'x.com']]))
    expect(lookup({ q: 3, r: 3 })).toBe('x.com')
    // Null, not undefined: with unclaimed hexes no longer stored, "no row" is the normal case
    // for the overwhelming majority of the map and must read as "unowned", not "unknown".
    expect(lookup({ q: 9, r: 9 })).toBeNull()
  })
})
