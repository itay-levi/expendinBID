import { describe, expect, it } from 'vitest'
import { checkHexEligibility } from './territoryEligibility'
import type { AxialCoord } from './hexMath'

function makeLookup(owned: Record<string, string>) {
  return (coord: AxialCoord) => owned[`${coord.q},${coord.r}`] ?? null
}

describe('checkHexEligibility', () => {
  it('allows a hex adjacent to the acquiring empire\'s own territory (expansion)', () => {
    const owners = makeLookup({ '0,0': 'stripe' })
    const result = checkHexEligibility({ q: 1, r: 0 }, owners, 'stripe')
    expect(result).toEqual({ eligible: true, reason: 'expansion' })
  })

  it('allows a hex with no owned neighbors at all (frontier — a fresh capital)', () => {
    const owners = makeLookup({})
    const result = checkHexEligibility({ q: 10, r: 10 }, owners, null)
    expect(result).toEqual({ eligible: true, reason: 'frontier' })
  })

  it('blocks a hex touching only a rival\'s territory, not the acquirer\'s', () => {
    const owners = makeLookup({ '1,0': 'vercel' })
    const result = checkHexEligibility({ q: 0, r: 0 }, owners, 'stripe')
    expect(result).toEqual({ eligible: false, reason: 'blocked' })
  })

  it('blocks a hex deep inside a rival empire even though it has owned neighbors (not the acquirer\'s)', () => {
    // A hex fully surrounded by the rival's territory — every neighbor is 'vercel', none is 'stripe'.
    const owners = makeLookup({
      '1,0': 'vercel', '1,-1': 'vercel', '0,-1': 'vercel',
      '-1,0': 'vercel', '-1,1': 'vercel', '0,1': 'vercel',
    })
    const result = checkHexEligibility({ q: 0, r: 0 }, owners, 'stripe')
    expect(result).toEqual({ eligible: false, reason: 'blocked' })
  })

  it('allows a brand-new empire (acquiringEmpireId null) to claim frontier but not border a rival', () => {
    const owners = makeLookup({ '1,0': 'vercel' })
    expect(checkHexEligibility({ q: 5, r: 5 }, owners, null).eligible).toBe(true)
    expect(checkHexEligibility({ q: 0, r: 0 }, owners, null).eligible).toBe(false)
  })

  it('treats a hex bordering both the acquirer and a rival as eligible expansion', () => {
    const owners = makeLookup({ '1,0': 'stripe', '-1,0': 'vercel' })
    const result = checkHexEligibility({ q: 0, r: 0 }, owners, 'stripe')
    expect(result).toEqual({ eligible: true, reason: 'expansion' })
  })
})
