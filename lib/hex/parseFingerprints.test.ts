import { describe, expect, it } from 'vitest'
import { parseFingerprints } from './takeoverGuard'

const valid = { hexId: 'hex_0,0', ownerId: null, lastPricePaidCents: 1_000 }

describe('parseFingerprints', () => {
  it('reads the JSON string checkout writes', () => {
    expect(parseFingerprints(JSON.stringify([valid])).get('hex_0,0')).toEqual(valid)
  })

  it('reads an already-parsed array', () => {
    expect(parseFingerprints([valid]).size).toBe(1)
  })

  it.each([
    ['garbage JSON', '{not json'],
    ['a non-array', JSON.stringify({ hexId: 'hex_0,0' })],
    ['undefined', undefined],
    ['a number', 42],
  ])('yields nothing for %s — which fails settlement closed', (_label, raw) => {
    expect(parseFingerprints(raw).size).toBe(0)
  })

  it('drops malformed entries and keeps well-formed ones', () => {
    const mixed = [
      valid,
      { hexId: 'hex_1,0', ownerId: 42, lastPricePaidCents: 1_000 },
      { hexId: 'hex_2,0', ownerId: null, lastPricePaidCents: '1000' },
      null,
      { ownerId: 'x.com', lastPricePaidCents: 1 },
    ]
    expect([...parseFingerprints(mixed).keys()]).toEqual(['hex_0,0'])
  })
})
