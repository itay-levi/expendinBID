'use client'

import { useEffect } from 'react'
import { useGameStore } from './gameStore'
import type { Empire, HexTile, MarketSnapshot } from '@/types/game'

/** How often the map is refetched. A stand-in for the realtime channel (ARCHITECTURE.md §8). */
export const MAP_POLL_INTERVAL_MS = 8_000

/** Window requested around the origin, in hex rings. Must stay under the API's own MAX_SPAN. */
const INITIAL_SPAN = 60

type MapResponse = {
  success: boolean
  data?: { hexes: HexTile[]; empires: Empire[]; market: MarketSnapshot }
}

/**
 * Keeps the client's map in sync with the database.
 *
 * Polling, not push — deliberately, and temporarily. The right answer is the realtime channel in
 * ARCHITECTURE.md §8, and this hook is shaped so swapping to it changes only where the snapshot
 * comes from: it already funnels everything through `loadSnapshot`, so a websocket delivering the
 * same payload is a drop-in. Until then, polling at least means two people looking at the map see
 * each other's purchases within a few seconds instead of never.
 */
export function useMapSync(): void {
  const loadSnapshot = useGameStore((state) => state.loadSnapshot)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function fetchMap() {
      try {
        const params = new URLSearchParams({
          minQ: String(-INITIAL_SPAN),
          maxQ: String(INITIAL_SPAN),
          minR: String(-INITIAL_SPAN),
          maxR: String(INITIAL_SPAN),
        })
        const response = await fetch(`/api/map?${params}`, { signal: controller.signal })
        if (!response.ok) return

        const body: MapResponse = await response.json()
        if (cancelled || !body.success || !body.data) return

        loadSnapshot({
          empires: body.data.empires,
          hexes: body.data.hexes,
          market: body.data.market,
        })
      } catch {
        // Swallowed: a failed poll is a transient gap, not a reason to tear the map down. The
        // previous snapshot stays on screen and the next tick tries again.
      }
    }

    void fetchMap()
    const interval = setInterval(fetchMap, MAP_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      controller.abort()
      clearInterval(interval)
    }
  }, [loadSnapshot])
}
