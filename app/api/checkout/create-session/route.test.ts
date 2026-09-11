import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetRateLimits } from '@/lib/security/rateLimit'
import { __resetInMemoryHexes, inMemoryHexRepository } from '@/lib/repository/hexRepository'
import { hexIdFor } from '@/lib/hex/hexIdentity'

// No network: the scrape resolves to the same hostname fallback a blocked site would get.
vi.mock('@/lib/brand/resolveBrandMetadata', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/brand/resolveBrandMetadata')>()
  return { ...actual, resolveBrandMetadataOrFallback: vi.fn(async (url: string) => actual.fallbackBrandMetadata(url)) }
})
vi.mock('@/lib/notifications/retaliationNotifier', () => ({ notifyDefenderOfTakeover: vi.fn(async () => undefined) }))
vi.mock('@/lib/payments/dodoClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/payments/dodoClient')>()),
  createDodoCheckoutSession: vi.fn(async () => ({
    sessionId: 'cks_1',
    checkoutUrl: 'https://test.checkout.dodopayments.com/session/cks_1',
  })),
}))

import { POST } from './route'
import { createDodoCheckoutSession } from '@/lib/payments/dodoClient'
import { getRepositories } from '@/lib/repository'

/** Far from the demo seed, so these tiles are guaranteed open ground. */
const OPEN_TILE = hexIdFor({ q: 80, r: -40 })
let domainCount = 0
const freshDomain = () => `https://buyer-${++domainCount}.route.test`

function checkout(body: unknown): Request {
  return new Request('http://localhost:3000/api/checkout/create-session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const valid = (overrides: Record<string, unknown> = {}) => ({
  hexIds: [OPEN_TILE],
  url: freshDomain(),
  agreedToTerms: true,
  ...overrides,
})

beforeEach(() => {
  resetRateLimits()
  __resetInMemoryHexes([])
  vi.stubEnv('USE_IN_MEMORY_REPOSITORIES', '1')
  vi.stubEnv('DODO_PAYMENTS_API_KEY', '')
  vi.stubEnv('PADDLE_API_KEY', '')
  vi.stubEnv('NODE_ENV', 'development')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.mocked(createDodoCheckoutSession).mockClear()
})

describe('POST /api/checkout/create-session', () => {
  it('refuses a purchase without explicit consent to the terms', async () => {
    const response = await POST(checkout(valid({ agreedToTerms: false })))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/Terms of Service/)
  })

  it('refuses malformed JSON and malformed bodies alike', async () => {
    expect((await POST(checkout('{not json'))).status).toBe(400)
    expect((await POST(checkout({ hexIds: 'hex_0,0', url: 'x', agreedToTerms: true }))).status).toBe(400)
  })

  it('refuses the same tile twice in one basket', async () => {
    expect((await POST(checkout(valid({ hexIds: [OPEN_TILE, OPEN_TILE] })))).status).toBe(400)
  })

  it('refuses an oversized request before parsing it', async () => {
    const response = await POST(checkout(valid({ url: `https://x.test/${'a'.repeat(40_000)}` })))
    expect(response.status).toBe(413)
  })

  it('refuses a domain that was blocked for a chargeback', async () => {
    const url = freshDomain()
    const { audit } = await getRepositories()
    await audit.blockDomain(new URL(url).hostname, 'chargeback', 'pay_1')

    const response = await POST(checkout(valid({ url })))
    expect(response.status).toBe(403)
    expect((await inMemoryHexRepository.getHexById(OPEN_TILE))?.ownerId).toBeNull()
  })

  it('refuses an unknown hex id', async () => {
    expect((await POST(checkout(valid({ hexIds: ['not-a-hex'] })))).status).toBe(404)
  })

  it('settles a demo claim in development, through the real settlement path', async () => {
    const url = freshDomain()
    const response = await POST(checkout(valid({ url })))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ success: true, code: 'demo_applied', data: { amountCents: 1_000 } })
    expect((await inMemoryHexRepository.getHexById(OPEN_TILE))?.ownerId).toBe(new URL(url).hostname)
  })

  it('closes checkout in production when no payment provider is configured', async () => {
    // The fail-open this replaces: a production deploy missing a key handed out free territory.
    vi.stubEnv('NODE_ENV', 'production')
    const response = await POST(checkout(valid()))
    expect(response.status).toBe(503)
    expect((await inMemoryHexRepository.getHexById(OPEN_TILE))?.ownerId).toBeNull()
  })

  it('opens a Dodo checkout for the server-computed amount, with everything settlement needs', async () => {
    vi.stubEnv('DODO_PAYMENTS_API_KEY', 'sk_test')
    vi.stubEnv('DODO_PAYMENTS_PRODUCT_ID', 'pdt_hex')
    const url = freshDomain()

    const response = await POST(checkout(valid({ url, primaryColorHex: '#635BFF' })))
    const body = await response.json()

    expect(body).toEqual({
      success: true,
      data: { checkoutUrl: 'https://test.checkout.dodopayments.com/session/cks_1', amountCents: 1_000 },
    })
    const [input] = vi.mocked(createDodoCheckoutSession).mock.calls[0]!
    expect(input.amountCents).toBe(1_000)
    expect(input.returnUrl).toBe('http://localhost:3000/checkout/complete')
    expect(input.metadata).toMatchObject({
      hexIds: JSON.stringify([OPEN_TILE]),
      // The URL the buyer typed — the identity checkout judged reachability as.
      targetUrl: new URL(url).toString(),
      quotedTotalCents: 1_000,
      primaryColorHex: '#635BFF',
    })
    // Nothing is granted until the payment webhook arrives.
    expect((await inMemoryHexRepository.getHexById(OPEN_TILE))?.ownerId).toBeNull()
  })

  it('never lets the client set the price', async () => {
    vi.stubEnv('DODO_PAYMENTS_API_KEY', 'sk_test')
    vi.stubEnv('DODO_PAYMENTS_PRODUCT_ID', 'pdt_hex')
    await POST(checkout(valid({ amountCents: 1, totalCents: 1, price: 1 })))
    expect(vi.mocked(createDodoCheckoutSession).mock.calls[0]?.[0].amountCents).toBe(1_000)
  })
})
