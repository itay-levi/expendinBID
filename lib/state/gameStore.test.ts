import { describe, expect, it, beforeEach } from 'vitest'
import { useGameStore, selectHexAt, selectHexById, selectOwnerAt } from './gameStore'
import { BASE_HEX_PRICE_CENTS } from '@/lib/pricing/takeoverPricing'
import type { Empire, HexTile } from '@/types/game'

function hex(overrides: Partial<HexTile> & { id: string; coord: { q: number; r: number } }): HexTile {
  return {
    ownerId: null,
    isCapital: false,
    lastPricePaidCents: BASE_HEX_PRICE_CENTS,
    isContested: false,
    ownedSince: null,
    lockedUntil: null,
    ...overrides,
  }
}

const empire: Empire = {
  id: 'acme.com',
  domain: 'acme.com',
  url: 'https://acme.com',
  name: 'Acme',
  logoUrl: '',
  primaryColorHex: '#8A2BE2',
  ogTitle: 'Acme',
  ogDescription: '',
  capitalHexId: 'hex_0,0',
  foundedAt: '2026-01-01T00:00:00.000Z',
  notifyWebhookUrl: null,
}

const initialState = useGameStore.getState()

describe('gameStore', () => {
  beforeEach(() => {
    useGameStore.setState({
      ...initialState,
      ownedHexes: new Map(),
      empires: new Map(),
      recentEvents: [],
      hoveredHexId: null,
      selectedHexIds: [],
      pendingBrand: null,
      myEmpireId: null,
    })
  })

  describe('sparse storage', () => {
    it('stores an owned hex', () => {
      useGameStore.getState().applyHexUpdate(hex({ id: 'hex_0,0', coord: { q: 0, r: 0 }, ownerId: 'acme.com' }))
      expect(useGameStore.getState().ownedHexes.size).toBe(1)
    })

    it('does NOT store a hex that reverted to open ground', () => {
      // The invariant the unbounded map rests on: an unowned hex leaves no row behind, so the
      // store's size tracks what has been sold rather than growing forever.
      const store = useGameStore.getState()
      store.applyHexUpdate(hex({ id: 'hex_0,0', coord: { q: 0, r: 0 }, ownerId: 'acme.com' }))
      store.applyHexUpdate(hex({ id: 'hex_0,0', coord: { q: 0, r: 0 }, ownerId: null }))
      expect(useGameStore.getState().ownedHexes.size).toBe(0)
    })

    it('keeps a protected or contested hex even with no owner', () => {
      // Both carry state that cannot be re-derived from the coordinate alone.
      const store = useGameStore.getState()
      store.applyHexUpdate(hex({ id: 'hex_1,0', coord: { q: 1, r: 0 }, lockedUntil: '2099-01-01T00:00:00.000Z' }))
      store.applyHexUpdate(hex({ id: 'hex_2,0', coord: { q: 2, r: 0 }, isContested: true }))
      expect(useGameStore.getState().ownedHexes.size).toBe(2)
    })

    it('drops unowned hexes when loading a snapshot', () => {
      useGameStore.getState().loadSnapshot({
        empires: [empire],
        hexes: [
          hex({ id: 'hex_0,0', coord: { q: 0, r: 0 }, ownerId: 'acme.com' }),
          hex({ id: 'hex_9,9', coord: { q: 9, r: 9 } }),
        ],
      })
      expect(useGameStore.getState().ownedHexes.size).toBe(1)
      expect(useGameStore.getState().empires.size).toBe(1)
    })

    it('mutates nothing in place — every update yields a new Map', () => {
      const before = useGameStore.getState().ownedHexes
      useGameStore.getState().applyHexUpdate(hex({ id: 'hex_0,0', coord: { q: 0, r: 0 }, ownerId: 'acme.com' }))
      expect(useGameStore.getState().ownedHexes).not.toBe(before)
      expect(before.size).toBe(0)
    })
  })

  describe('selection', () => {
    it('accumulates hexes in click order', () => {
      const { toggleHexSelection } = useGameStore.getState()
      toggleHexSelection('hex_0,0')
      toggleHexSelection('hex_1,0')
      expect(useGameStore.getState().selectedHexIds).toEqual(['hex_0,0', 'hex_1,0'])
    })

    it('toggles a hex back out without disturbing the rest', () => {
      const { toggleHexSelection } = useGameStore.getState()
      toggleHexSelection('hex_0,0')
      toggleHexSelection('hex_1,0')
      toggleHexSelection('hex_0,0')
      expect(useGameStore.getState().selectedHexIds).toEqual(['hex_1,0'])
    })

    it('clears the whole basket', () => {
      const { toggleHexSelection, clearSelection } = useGameStore.getState()
      toggleHexSelection('hex_0,0')
      clearSelection()
      expect(useGameStore.getState().selectedHexIds).toEqual([])
    })

    it('PRESERVES the basket across a snapshot load', () => {
      // loadSnapshot runs on every poll of /api/map. Clearing the selection here wiped the buyer's
      // tiles every few seconds mid-flow, which read as "I select one and the rest deselect".
      // Nothing needs clearing: price and eligibility are re-derived from the incoming hexes.
      useGameStore.getState().toggleHexSelection('hex_0,0')
      useGameStore.getState().toggleHexSelection('hex_1,0')
      useGameStore.getState().loadSnapshot({ empires: [], hexes: [] })
      expect(useGameStore.getState().selectedHexIds).toEqual(['hex_0,0', 'hex_1,0'])
    })

    it('survives repeated polls, the way the real sync loop calls it', () => {
      useGameStore.getState().toggleHexSelection('hex_2,2')
      for (let poll = 0; poll < 10; poll += 1) {
        useGameStore.getState().loadSnapshot({ empires: [], hexes: [] })
      }
      expect(useGameStore.getState().selectedHexIds).toEqual(['hex_2,2'])
    })
  })

  describe('selectors', () => {
    beforeEach(() => {
      useGameStore.getState().applyHexUpdate(
        hex({ id: 'hex_0,0', coord: { q: 0, r: 0 }, ownerId: 'acme.com', lastPricePaidCents: 4_500 }),
      )
    })

    it('returns the stored row for an owned coordinate', () => {
      const state = useGameStore.getState()
      expect(selectHexAt(state, { q: 0, r: 0 }).lastPricePaidCents).toBe(4_500)
      expect(selectOwnerAt(state, { q: 0, r: 0 })).toBe('acme.com')
    })

    it('synthesizes an unclaimed hex anywhere else, however far out', () => {
      const state = useGameStore.getState()
      const far = selectHexAt(state, { q: 12_345, r: -6_789 })
      expect(far.ownerId).toBeNull()
      expect(far.lastPricePaidCents).toBe(BASE_HEX_PRICE_CENTS)
      expect(selectOwnerAt(state, { q: 12_345, r: -6_789 })).toBeNull()
    })

    it('resolves by id, and returns null only for a malformed one', () => {
      const state = useGameStore.getState()
      expect(selectHexById(state, 'hex_0,0')?.ownerId).toBe('acme.com')
      expect(selectHexById(state, 'hex_5,5')?.ownerId).toBeNull()
      expect(selectHexById(state, 'bogus')).toBeNull()
    })
  })

  describe('isUnderAttack', () => {
    it('is true only while that empire holds a contested hex', () => {
      const store = useGameStore.getState()
      store.applyHexUpdate(
        hex({ id: 'hex_0,0', coord: { q: 0, r: 0 }, ownerId: 'acme.com', isContested: true }),
      )
      expect(useGameStore.getState().isUnderAttack('acme.com')).toBe(true)
      expect(useGameStore.getState().isUnderAttack('other.com')).toBe(false)
    })

    it('is false when the empire holds nothing contested', () => {
      useGameStore.getState().applyHexUpdate(
        hex({ id: 'hex_0,0', coord: { q: 0, r: 0 }, ownerId: 'acme.com' }),
      )
      expect(useGameStore.getState().isUnderAttack('acme.com')).toBe(false)
    })
  })

  describe('events and market', () => {
    it('keeps the newest events first and caps the log at 50', () => {
      const { applyTakeoverEvent } = useGameStore.getState()
      for (let i = 0; i < 60; i += 1) {
        applyTakeoverEvent({
          id: `event-${i}`,
          hexId: 'hex_0,0',
          attackerEmpireId: 'acme.com',
          defenderEmpireId: null,
          pricePaidCents: 100,
          createdAt: '2026-01-01T00:00:00.000Z',
        })
      }
      const events = useGameStore.getState().recentEvents
      expect(events).toHaveLength(50)
      expect(events[0]?.id).toBe('event-59')
    })

    it('replaces the market snapshot wholesale', () => {
      useGameStore.getState().applyMarketSnapshot({
        totalWarRevenueCents: 999,
        activeConflicts: 1,
        globalMarketCapCents: 2,
        totalTakeoverEvents: 3,
        avgRevenuePerTakeoverCents: 4,
        avgControlDurationSeconds: 5,
      })
      expect(useGameStore.getState().market.totalWarRevenueCents).toBe(999)
    })
  })

  describe('simple setters', () => {
    it('tracks hover, pending brand and empire identity', () => {
      const store = useGameStore.getState()
      store.setHoveredHex('hex_1,1')
      store.setMyEmpireId('acme.com')
      store.setPendingBrand({
        url: 'https://acme.com',
        domain: 'acme.com',
        title: 'Acme',
        description: 'Things',
        logoUrl: 'https://acme.com/logo.png',
      })
      store.applyEmpireUpsert(empire)

      const state = useGameStore.getState()
      expect(state.hoveredHexId).toBe('hex_1,1')
      expect(state.myEmpireId).toBe('acme.com')
      expect(state.pendingBrand?.domain).toBe('acme.com')
      expect(state.empires.get('acme.com')?.name).toBe('Acme')
    })

    it('clears hover and pending brand back to null', () => {
      const store = useGameStore.getState()
      store.setHoveredHex('hex_1,1')
      store.setHoveredHex(null)
      store.setPendingBrand(null)
      expect(useGameStore.getState().hoveredHexId).toBeNull()
      expect(useGameStore.getState().pendingBrand).toBeNull()
    })
  })
})
