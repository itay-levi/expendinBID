import { describe, expect, it } from 'vitest'
import { checkHexEligibility } from './territoryEligibility'
import type { AxialCoord } from './hexMath'

function makeLookup(owned: Record<string, string>) {
  return (coord: AxialCoord) => owned[`${coord.q},${coord.r}`] ?? null
}

/** Every neighbour of the origin held by one rival — the genuinely sealed-in case. */
const SEALED_BY_RIVAL = {
  '1,0': 'vercel', '1,-1': 'vercel', '0,-1': 'vercel',
  '-1,0': 'vercel', '-1,1': 'vercel', '0,1': 'vercel',
}

describe('checkHexEligibility', () => {
  it('allows a hex adjacent to the acquiring empire own territory (expansion)', () => {
    const owners = makeLookup({ '0,0': 'stripe' })
    expect(checkHexEligibility({ q: 1, r: 0 }, owners, 'stripe', null)).toEqual({
      eligible: true,
      reason: 'expansion',
    })
  })

  it('allows a hex with no owned neighbors at all (frontier, a fresh capital)', () => {
    const owners = makeLookup({})
    expect(checkHexEligibility({ q: 10, r: 10 }, owners, null, null)).toEqual({
      eligible: true,
      reason: 'frontier',
    })
  })

  it('blocks TAKING a rival hex that touches only their territory, not the acquirer', () => {
    // The rule's real subject: an owned tile has to be reached by fighting to its border.
    const owners = makeLookup({ '0,0': 'vercel', '1,0': 'vercel' })
    expect(checkHexEligibility({ q: 0, r: 0 }, owners, 'stripe', 'vercel')).toEqual({
      eligible: false,
      reason: 'blocked',
    })
  })

  it('SELLS open ground that merely touches a rival, instead of sealing a moat around them', () => {
    // The regression that left the claim bar unable to price anything: an unclaimed tile beside an
    // empire is frontier, not ground behind their lines.
    const owners = makeLookup({ '1,0': 'vercel' })
    expect(checkHexEligibility({ q: 0, r: 0 }, owners, 'stripe', null)).toEqual({
      eligible: true,
      reason: 'frontier',
    })
  })

  it('still refuses open ground sealed on all six sides by one rival', () => {
    const owners = makeLookup(SEALED_BY_RIVAL)
    expect(checkHexEligibility({ q: 0, r: 0 }, owners, 'stripe', null)).toEqual({
      eligible: false,
      reason: 'blocked',
    })
  })

  it('blocks a rival hex deep inside their empire', () => {
    const owners = makeLookup({ ...SEALED_BY_RIVAL, '0,0': 'vercel' })
    expect(checkHexEligibility({ q: 0, r: 0 }, owners, 'stripe', 'vercel')).toEqual({
      eligible: false,
      reason: 'blocked',
    })
  })

  it('lets a brand-new empire claim frontier AND open ground beside a rival', () => {
    // A newcomer owns nothing to expand from, so if bordering an empire disqualified them they
    // could never buy anywhere near the part of the map actually worth advertising on.
    const owners = makeLookup({ '1,0': 'vercel' })
    expect(checkHexEligibility({ q: 5, r: 5 }, owners, null, null).eligible).toBe(true)
    expect(checkHexEligibility({ q: 0, r: 0 }, owners, null, null).eligible).toBe(true)
  })

  it('treats a hex bordering both the acquirer and a rival as eligible expansion', () => {
    const owners = makeLookup({ '1,0': 'stripe', '-1,0': 'vercel' })
    expect(checkHexEligibility({ q: 0, r: 0 }, owners, 'stripe', null)).toEqual({
      eligible: true,
      reason: 'expansion',
    })
  })
})
