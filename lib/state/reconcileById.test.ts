import { describe, expect, it } from 'vitest'
import { reconcileById, useGameStore } from './gameStore'
import type { Empire, HexTile, MarketSnapshot } from '@/types/game'

type Item = { id: string; value: number }
const same = (a: Item, b: Item) => a.value === b.value

describe('reconcileById', () => {
  it('returns the SAME map when an identical snapshot arrives', () => {
    // The whole point: subscribers compare by reference, so an unchanged poll must cost nothing.
    const previous = new Map([['a', { id: 'a', value: 1 }], ['b', { id: 'b', value: 2 }]])
    const next = reconcileById(previous, [{ id: 'a', value: 1 }, { id: 'b', value: 2 }], same)
    expect(next).toBe(previous)
  })

  it('keeps unchanged entries by identity when a sibling changes', () => {
    const a = { id: 'a', value: 1 }
    const previous = new Map([['a', a], ['b', { id: 'b', value: 2 }]])
    const next = reconcileById(previous, [{ id: 'a', value: 1 }, { id: 'b', value: 3 }], same)
    expect(next).not.toBe(previous)
    expect(next.get('a')).toBe(a)
    expect(next.get('b')?.value).toBe(3)
  })

  it('detects an added entry', () => {
    const previous = new Map([['a', { id: 'a', value: 1 }]])
    const next = reconcileById(previous, [{ id: 'a', value: 1 }, { id: 'b', value: 2 }], same)
    expect(next.size).toBe(2)
    expect(next).not.toBe(previous)
  })

  it('detects a removed entry', () => {
    const previous = new Map([['a', { id: 'a', value: 1 }], ['b', { id: 'b', value: 2 }]])
    const next = reconcileById(previous, [{ id: 'a', value: 1 }], same)
    expect([...next.keys()]).toEqual(['a'])
  })

  it('detects a removal hidden by a duplicate in the incoming list', () => {
    // Same length as before, every item "unchanged" — but b is gone. Size, not length, decides.
    const previous = new Map([['a', { id: 'a', value: 1 }], ['b', { id: 'b', value: 2 }]])
    const next = reconcileById(previous, [{ id: 'a', value: 1 }, { id: 'a', value: 1 }], same)
    expect(next.has('b')).toBe(false)
  })
})

const hex = (q: number, ownerId: string, price = 1_000): HexTile => ({
  id: `hex_${q},0`,
  coord: { q, r: 0 },
  ownerId,
  isCapital: false,
  lastPricePaidCents: price,
  isContested: false,
  ownedSince: '2026-01-01T00:00:00.000Z',
  lockedUntil: null,
})

const empire = (id: string, color = '#FB923C'): Empire => ({
  id,
  domain: id,
  name: id,
  url: `https://${id}`,
  logoUrl: '',
  primaryColorHex: color,
  ogTitle: id,
  ogDescription: '',
  capitalHexId: '',
  foundedAt: '2026-01-01T00:00:00.000Z',
  notifyWebhookUrl: null,
})

const market: MarketSnapshot = {
  totalWarRevenueCents: 100,
  activeConflicts: 0,
  globalMarketCapCents: 100,
  totalTakeoverEvents: 1,
  avgRevenuePerTakeoverCents: 100,
  avgControlDurationSeconds: 60,
}

describe('loadSnapshot on a repeat poll', () => {
  it('leaves every map reference untouched when nothing changed', () => {
    const { loadSnapshot } = useGameStore.getState()
    loadSnapshot({ empires: [empire('a.com')], hexes: [hex(0, 'a.com')], market })
    const before = useGameStore.getState()

    // A fresh copy of the same world, exactly as the next poll delivers it.
    loadSnapshot({ empires: [empire('a.com')], hexes: [hex(0, 'a.com')], market: { ...market } })
    const after = useGameStore.getState()

    expect(after.ownedHexes).toBe(before.ownedHexes)
    expect(after.empires).toBe(before.empires)
    expect(after.market).toBe(before.market)
  })

  it('still applies a real change', () => {
    const { loadSnapshot } = useGameStore.getState()
    loadSnapshot({ empires: [empire('a.com')], hexes: [hex(0, 'a.com')], market })
    loadSnapshot({ empires: [empire('a.com', '#635BFF')], hexes: [hex(0, 'b.com', 1_500)], market })
    const state = useGameStore.getState()
    expect(state.empires.get('a.com')?.primaryColorHex).toBe('#635BFF')
    expect(state.ownedHexes.get('hex_0,0')?.ownerId).toBe('b.com')
  })
})
