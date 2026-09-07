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

/**
 * Best-effort client identity. `x-forwarded-for` is trivially spoofable unless the app sits behind
 * a proxy that overwrites it, so this is abuse-dampening, not authentication. Take the FIRST entry:
 * appending values to that header is exactly how a caller tries to rotate identity per request.
 */
export function clientKeyFromRequest(request: Request, scope: string): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const ip = forwarded?.split(',')[0]?.trim() || realIp?.trim() || 'unknown'
  return `${scope}:${ip}`
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
