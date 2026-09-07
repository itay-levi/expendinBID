import { NextResponse } from 'next/server'

// Proxies DataFast's realtime-visitors endpoint (confirmed shape: GET /api/v1/analytics/realtime,
// Bearer auth, `{ status, data: [{ visitors }] }`). Kept server-side so the API key never reaches
// the browser. Returns null (not a fabricated number) whenever the integration isn't configured
// or the upstream call fails — the HUD widget must render "—", never a made-up count.
export const runtime = 'nodejs'

// Every connected client polls this every 15s. Without a shared cache, 10k concurrent visitors
// means ~667 upstream calls/second to DataFast — which would rate-limit us, cost money, and add
// latency to every poll. One cached value serves them all. (Process-local: a multi-instance
// deployment caches per instance, which is still a linear reduction. See ARCHITECTURE.md §24.)
const CACHE_TTL_MS = 10_000
let cached: { value: number | null; at: number } | null = null
let inFlight: Promise<number | null> | null = null

async function fetchActiveVisitors(apiKey: string, websiteId: string | undefined): Promise<number | null> {
  const url = new URL('https://datafa.st/api/v1/analytics/realtime')
  url.searchParams.set('fields', 'visitors')
  if (websiteId) url.searchParams.set('websiteId', websiteId)

  try {
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(4_000),
      cache: 'no-store',
    })
    if (!response.ok) return null
    const body = (await response.json()) as { data?: Array<{ visitors?: number }> }
    const visitors = body.data?.[0]?.visitors
    return typeof visitors === 'number' ? visitors : null
  } catch {
    return null
  }
}

export async function GET(): Promise<Response> {
  const apiKey = process.env.DATAFAST_API_KEY
  const websiteId = process.env.DATAFAST_WEBSITE_ID

  if (!apiKey) {
    return NextResponse.json({ success: true, data: { activeVisitors: null } })
  }

  const now = Date.now()
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ success: true, data: { activeVisitors: cached.value } })
  }

  // Single-flight: a burst of simultaneous misses shares one upstream request instead of
  // stampeding DataFast the moment the cache expires.
  if (!inFlight) {
    inFlight = fetchActiveVisitors(apiKey, websiteId).finally(() => {
      inFlight = null
    })
  }
  const value = await inFlight
  cached = { value, at: Date.now() }
  return NextResponse.json({ success: true, data: { activeVisitors: value } })
}
