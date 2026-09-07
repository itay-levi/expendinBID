import { useEffect, useState } from 'react'

const POLL_INTERVAL_MS = 15_000

/**
 * Polls the server-side DataFast proxy. Returns `null` (never a placeholder number) whenever the
 * integration isn't configured or a request fails — callers must render that as "no data," not
 * substitute a made-up figure. See ARCHITECTURE.md §19 for why this distinction matters here.
 */
export function useLiveVisitors(): number | null {
  const [activeVisitors, setActiveVisitors] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const response = await fetch('/api/analytics/live-visitors')
        const body = await response.json()
        if (!cancelled) setActiveVisitors(body?.data?.activeVisitors ?? null)
      } catch {
        if (!cancelled) setActiveVisitors(null)
      }
    }

    poll()
    const interval = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return activeVisitors
}
