import { beforeEach, describe, expect, it } from 'vitest'
import { clientKeyFromRequest, rateLimit, resetRateLimits } from './rateLimit'

beforeEach(() => resetRateLimits())

describe('rateLimit', () => {
  it('allows requests up to the limit and blocks the one after', () => {
    const now = 1_000_000
    for (let i = 0; i < 5; i++) {
      expect(rateLimit('k', 5, 60_000, now).allowed).toBe(true)
    }
    const blocked = rateLimit('k', 5, 60_000, now)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('reports remaining budget accurately', () => {
    const now = 2_000_000
    expect(rateLimit('r', 3, 60_000, now).remaining).toBe(2)
    expect(rateLimit('r', 3, 60_000, now).remaining).toBe(1)
    expect(rateLimit('r', 3, 60_000, now).remaining).toBe(0)
  })

  it('starts a fresh window once the old one expires', () => {
    const start = 3_000_000
    expect(rateLimit('w', 1, 1_000, start).allowed).toBe(true)
    expect(rateLimit('w', 1, 1_000, start + 500).allowed).toBe(false)
    expect(rateLimit('w', 1, 1_000, start + 1_500).allowed).toBe(true)
  })

  it('tracks each key independently, so one abuser cannot lock out everyone', () => {
    const now = 4_000_000
    expect(rateLimit('ip-a', 1, 60_000, now).allowed).toBe(true)
    expect(rateLimit('ip-a', 1, 60_000, now).allowed).toBe(false)
    expect(rateLimit('ip-b', 1, 60_000, now).allowed).toBe(true)
  })

  it('keeps scopes separate so one endpoint does not consume another endpoint budget', () => {
    const now = 5_000_000
    expect(rateLimit('checkout:1.1.1.1', 1, 60_000, now).allowed).toBe(true)
    expect(rateLimit('brand-resolve:1.1.1.1', 1, 60_000, now).allowed).toBe(true)
  })
})

describe('clientKeyFromRequest', () => {
  const req = (headers: Record<string, string>) => new Request('https://example.test', { headers })

  it('uses the address appended by the nearest trusted proxy', () => {
    // "client-sent, proxy-appended": the proxy's entry is the rightmost one.
    expect(clientKeyFromRequest(req({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }), 's')).toBe('s:10.0.0.1')
  })

  it('cannot be rotated by forging the leftmost value', () => {
    // The attack the old first-entry rule allowed: a fresh forged value per request, each landing in
    // a new bucket. Behind a proxy the real address is appended after whatever the caller sent.
    const keys = ['1.1.1.1', '2.2.2.2', 'whatever'].map((forged) =>
      clientKeyFromRequest(req({ 'x-forwarded-for': `${forged}, 203.0.113.7` }), 's'),
    )
    expect(new Set(keys)).toEqual(new Set(['s:203.0.113.7']))
  })

  it('honours a longer trusted proxy chain', () => {
    const header = { 'x-forwarded-for': 'forged, 203.0.113.7, 10.0.0.2' }
    expect(clientKeyFromRequest(req(header), 's', 2)).toBe('s:203.0.113.7')
  })

  it('uses the single value Vercel writes', () => {
    expect(clientKeyFromRequest(req({ 'x-forwarded-for': '203.0.113.7' }), 's')).toBe('s:203.0.113.7')
  })

  it('falls back to x-real-ip, then to a constant bucket', () => {
    expect(clientKeyFromRequest(req({ 'x-real-ip': '8.8.8.8' }), 's')).toBe('s:8.8.8.8')
    expect(clientKeyFromRequest(req({}), 's')).toBe('s:unknown')
  })

  it('bounds the key length so an oversized header cannot bloat the bucket map', () => {
    const key = clientKeyFromRequest(req({ 'x-forwarded-for': 'a'.repeat(5_000) }), 's')
    expect(key.length).toBeLessThanOrEqual(2 + 64)
  })
})
