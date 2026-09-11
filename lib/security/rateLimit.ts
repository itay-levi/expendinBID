/**
 * Fixed-window rate limiter.
 *
 * IMPORTANT SCOPE LIMIT: the counters live in this process's memory. On a single long-running
 * server that is a real limit. On serverless/multi-instance hosting each instance keeps its own
 * counters, so the effective limit is (limit x instances) — enough to blunt naive floods, not a
 * substitute for a shared store. Swap `rateLimit` for a Redis/Upstash-backed implementation
 * before relying on it as a hard control. See ARCHITECTURE.md §24.
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()
let lastSweep = Date.now()
const SWEEP_INTERVAL_MS = 60_000

function sweepExpired(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return
  lastSweep = now
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export type RateLimitResult = {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

export function rateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): RateLimitResult {
  sweepExpired(now)

  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 }
  }

  existing.count += 1
  const allowed = existing.count <= limit
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  }
}

/** Test seam — the module-level map otherwise leaks state between test cases. */
export function resetRateLimits(): void {
  buckets.clear()
  lastSweep = Date.now()
}

/** Longest client key kept. A header is attacker-sized; the bucket map should not be. */
const MAX_KEY_IP_LENGTH = 64

/**
 * How many reverse proxies sit in front of the app and append to `x-forwarded-for`.
 *
 * One covers Vercel (which overwrites the header with the real client address) and a single
 * nginx/Cloudflare hop. Set TRUSTED_PROXY_HOPS if the chain is longer.
 */
function trustedProxyHops(): number {
  const configured = Number(process.env.TRUSTED_PROXY_HOPS ?? 1)
  return Number.isInteger(configured) && configured >= 1 && configured <= 10 ? configured : 1
}

/**
 * Best-effort client identity for rate limiting.
 *
 * Reads `x-forwarded-for` from the RIGHT. Each proxy appends the address it received the connection
 * from, so the rightmost entries are the ones our own infrastructure wrote and the leftmost ones are
 * whatever the caller put there. Taking the FIRST entry — as this used to — handed the caller a
 * fresh bucket per request just by sending a different forged value each time, which made every
 * limit in the app decorative.
 *
 * Still abuse-dampening, not authentication: with no proxy in front at all, every one of these
 * headers is caller-controlled, so production must run behind one.
 */
export function clientKeyFromRequest(request: Request, scope: string, hops: number = trustedProxyHops()): string {
  const chain = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const fromProxy = chain.length > 0 ? chain[Math.max(0, chain.length - hops)] : undefined
  const ip = fromProxy || request.headers.get('x-real-ip')?.trim() || 'unknown'
  return `${scope}:${ip.slice(0, MAX_KEY_IP_LENGTH)}`
}

export function tooManyRequests(retryAfterSeconds: number): Response {
  return new Response(JSON.stringify({ success: false, error: 'Too many requests. Please slow down.' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(Math.max(1, retryAfterSeconds)),
    },
  })
}
