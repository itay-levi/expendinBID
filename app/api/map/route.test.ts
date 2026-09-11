import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetRateLimits } from '@/lib/security/rateLimit'
import { GET } from './route'

const map = (query: string) => GET(new Request(`http://localhost:3000/api/map?${query}`))

beforeEach(() => {
  resetRateLimits()
  vi.stubEnv('USE_IN_MEMORY_REPOSITORIES', '1')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/map', () => {
  it('returns sold hexes, their owners and the market for a window', async () => {
    const response = await map('minQ=-20&maxQ=20&minR=-20&maxR=20')
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.hexes)).toBe(true)
    expect(body.data).toHaveProperty('market')
    // Only owners of tiles in the window are sent, never every empire that exists.
    const owners = new Set(body.data.hexes.map((hex: { ownerId: string }) => hex.ownerId))
    for (const empire of body.data.empires as Array<{ id: string }>) expect(owners.has(empire.id)).toBe(true)
  })

  it('works with no window at all, using the default', async () => {
    expect((await GET(new Request('http://localhost:3000/api/map'))).status).toBe(200)
  })

  it('refuses an inverted window', async () => {
    expect((await map('minQ=10&maxQ=0&minR=0&maxR=10')).status).toBe(400)
  })

  it('refuses a window too large to be a bounded read', async () => {
    // The map is unbounded, so the request is the only thing that bounds the query.
    const response = await map('minQ=-100000&maxQ=100000&minR=0&maxR=10')
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/too large/i)
  })

  it('refuses coordinates that are not integers', async () => {
    expect((await map('minQ=1.5&maxQ=2&minR=0&maxR=1')).status).toBe(400)
    expect((await map('minQ=abc&maxQ=2&minR=0&maxR=1')).status).toBe(400)
  })
})
