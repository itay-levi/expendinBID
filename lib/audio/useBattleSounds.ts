'use client'

import { useEffect } from 'react'
import { useGameStore, type GameStore } from '@/lib/state/gameStore'
import { soundEngine } from './soundEngine'

/** The slice of the engine this listener drives — a seam, so the rules are testable without audio. */
export type BattleSoundOutput = Pick<typeof soundEngine, 'playOneShot' | 'startAlarmLoop' | 'stopAlarmLoop'>

type SoundState = Pick<GameStore, 'selectedHexIds' | 'market' | 'ownedHexes' | 'myEmpireId' | 'isUnderAttack'>

/**
 * Decides which sounds a store change deserves. Pure apart from the output it is handed.
 *
 *  - a tile joining the basket ticks;
 *  - the takeover ledger growing — someone, anywhere on the map, just took ground — plays the sting;
 *  - the buyer's own territory coming under attack starts the siren, and it stops when that ends.
 *
 * The attack check walks every owned tile, so it only re-runs when territory or identity actually
 * changed. The store also updates on every pointer move (hover), and re-scanning the map on each of
 * those would be a steady cost for no new information.
 */
export function createBattleSoundListener(initial: SoundState, output: BattleSoundOutput) {
  let selected = initial.selectedHexIds.length
  let takeovers = initial.market.totalTakeoverEvents
  let territory = initial.ownedHexes
  let identity = initial.myEmpireId
  let alarmOn = false

  const underAttack = (state: SoundState) => (state.myEmpireId ? state.isUnderAttack(state.myEmpireId) : false)

  const syncAlarm = (attacked: boolean) => {
    if (attacked && !alarmOn) output.startAlarmLoop()
    if (!attacked && alarmOn) output.stopAlarmLoop()
    alarmOn = attacked
  }

  syncAlarm(underAttack(initial))

  return {
    onChange(state: SoundState): void {
      if (state.selectedHexIds.length > selected) output.playOneShot('select')
      if (state.market.totalTakeoverEvents > takeovers) output.playOneShot('takeover')
      selected = state.selectedHexIds.length
      takeovers = state.market.totalTakeoverEvents

      if (state.ownedHexes !== territory || state.myEmpireId !== identity) {
        territory = state.ownedHexes
        identity = state.myEmpireId
        syncAlarm(underAttack(state))
      }
    },
    stop(): void {
      syncAlarm(false)
    },
  }
}

/**
 * Plays the game's sound effects while sound is switched on. Subscribes outside React's render
 * cycle, so it never causes a re-render; switching sound off or unmounting silences the siren.
 */
export function useBattleSounds(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const listener = createBattleSoundListener(useGameStore.getState(), soundEngine)
    const unsubscribe = useGameStore.subscribe((state) => listener.onChange(state))
    return () => {
      unsubscribe()
      listener.stop()
    }
  }, [enabled])
}
