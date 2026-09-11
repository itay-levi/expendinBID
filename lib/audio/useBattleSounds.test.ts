import { describe, expect, it, vi } from 'vitest'
import { createBattleSoundListener, type BattleSoundOutput } from './useBattleSounds'
import type { MarketSnapshot } from '@/types/game'

type State = Parameters<typeof createBattleSoundListener>[0]

const market = (totalTakeoverEvents = 0): MarketSnapshot => ({
  totalWarRevenueCents: 0,
  activeConflicts: 0,
  globalMarketCapCents: 0,
  totalTakeoverEvents,
  avgRevenuePerTakeoverCents: 0,
  avgControlDurationSeconds: 0,
})

function state(overrides: Partial<State> = {}): State {
  return {
    selectedHexIds: [],
    market: market(),
    ownedHexes: new Map(),
    myEmpireId: null,
    isUnderAttack: () => false,
    ...overrides,
  }
}

function output(): BattleSoundOutput & { [K in keyof BattleSoundOutput]: ReturnType<typeof vi.fn> } {
  return { playOneShot: vi.fn(), startAlarmLoop: vi.fn(), stopAlarmLoop: vi.fn() }
}

describe('createBattleSoundListener', () => {
  it('ticks when a tile joins the basket, and not when one leaves', () => {
    const sounds = output()
    const listener = createBattleSoundListener(state(), sounds)

    listener.onChange(state({ selectedHexIds: ['hex_0,0'] }))
    listener.onChange(state({ selectedHexIds: [] }))

    expect(sounds.playOneShot).toHaveBeenCalledTimes(1)
    expect(sounds.playOneShot).toHaveBeenCalledWith('select')
  })

  it('plays the takeover sting when the ledger grows', () => {
    const sounds = output()
    const listener = createBattleSoundListener(state(), sounds)
    listener.onChange(state({ market: market(1) }))
    expect(sounds.playOneShot).toHaveBeenCalledWith('takeover')
  })

  it('sounds the siren while the buyer’s own territory is under attack, once, and stops it after', () => {
    const sounds = output()
    const listener = createBattleSoundListener(state({ myEmpireId: 'me.com' }), sounds)

    const attacked = state({ myEmpireId: 'me.com', ownedHexes: new Map(), isUnderAttack: () => true })
    listener.onChange(attacked)
    listener.onChange({ ...attacked, ownedHexes: new Map() })
    expect(sounds.startAlarmLoop).toHaveBeenCalledTimes(1)

    listener.onChange(state({ myEmpireId: 'me.com', ownedHexes: new Map(), isUnderAttack: () => false }))
    expect(sounds.stopAlarmLoop).toHaveBeenCalledTimes(1)
  })

  it('never sounds the siren for a visitor who owns nothing', () => {
    const sounds = output()
    const listener = createBattleSoundListener(state(), sounds)
    listener.onChange(state({ ownedHexes: new Map(), isUnderAttack: () => true }))
    expect(sounds.startAlarmLoop).not.toHaveBeenCalled()
  })

  it('does not re-scan the map on changes that cannot affect an attack, like hovering', () => {
    const sounds = output()
    const isUnderAttack = vi.fn(() => false)
    const initial = state({ myEmpireId: 'me.com', isUnderAttack })
    const listener = createBattleSoundListener(initial, sounds)
    const scansAfterStart = isUnderAttack.mock.calls.length

    // Same territory Map and identity — the store update came from somewhere else entirely.
    for (let index = 0; index < 50; index += 1) listener.onChange({ ...initial })
    expect(isUnderAttack.mock.calls.length).toBe(scansAfterStart)
  })

  it('silences the siren when sound is switched off', () => {
    const sounds = output()
    const listener = createBattleSoundListener(state({ myEmpireId: 'me.com', isUnderAttack: () => true }), sounds)
    expect(sounds.startAlarmLoop).toHaveBeenCalledTimes(1)
    listener.stop()
    expect(sounds.stopAlarmLoop).toHaveBeenCalledTimes(1)
  })
})
