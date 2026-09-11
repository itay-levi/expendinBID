'use client'

import { useEffect, useState } from 'react'
import { useGameStore } from './gameStore'
import type { Empire, HexTile, MarketSnapshot } from '@/types/game'

/** How often the map is refetched. A stand-in for the realtime channel (ARCHITECTURE.md §8). */
export const MAP_POLL_INTERVAL_MS = 8_000

/** Window requested around the origin, in hex rings. Must stay under the API's own MAX_SPAN. */
const INITIAL_SPAN = 60

/** Consecutive failed polls before the map admits it may be out of date. One blip is just noise. */
const FAILURES_BEFORE_STALE = 2

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
export function useMapSync(): { healthy: boolean } {
  const loadSnapshot = useGameStore((state) => state.loadSnapshot)
  // Failed polls are still swallowed — the last snapshot stays on screen — but after a couple in a
  // row the page says so, rather than presenting a possibly stale map as live.
  const [healthy, setHealthy] = useState(true)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    // Polls overlap whenever one is slow. Responses are applied in the order they were REQUESTED,
    // not the order they arrive: a late reply to an older poll used to overwrite a newer snapshot
    // and briefly revert fresh purchases on screen.
    let issued = 0
    let latestApplied = 0
    let failures = 0
    const recordFailure = () => {
      failures += 1
      if (failures >= FAILURES_BEFORE_STALE && !cancelled) setHealthy(false)
    }

    async function fetchMap() {
      const sequence = ++issued
      try {
        const params = new URLSearchParams({
          minQ: String(-INITIAL_SPAN),
          maxQ: String(INITIAL_SPAN),
          minR: String(-INITIAL_SPAN),
          maxR: String(INITIAL_SPAN),
        })
        const response = await fetch(`/api/map?${params}`, { signal: controller.signal })
        if (!response.ok) {
          // A failure older than the last snapshot applied says nothing about the map now.
          if (sequence > latestApplied) recordFailure()
          return
        }

        const body: MapResponse = await response.json()
        if (cancelled || !body.success || !body.data) return
        if (sequence < latestApplied) return
        latestApplied = sequence
        failures = 0
        setHealthy(true)

        loadSnapshot({
          empires: body.data.empires,
          hexes: body.data.hexes,
          market: body.data.market,
        })
      } catch {
        // Swallowed: a failed poll is a transient gap, not a reason to tear the map down. The
        // previous snapshot stays on screen and the next tick tries again.
        if (!controller.signal.aborted && sequence > latestApplied) recordFailure()
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

  return { healthy }
}
