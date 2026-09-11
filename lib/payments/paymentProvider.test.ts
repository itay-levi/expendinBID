import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDemoModeAllowed, selectPaymentProvider, siteOrigin } from './paymentProvider'

const DODO = { DODO_PAYMENTS_API_KEY: 'k', DODO_PAYMENTS_PRODUCT_ID: 'p' }

afterEach(() => {
  vi.unstubAllEnvs()
})

function withPaddle() {
  vi.stubEnv('PADDLE_API_KEY', 'pdl_key')
  vi.stubEnv('PADDLE_PRICE_ID', 'pri_1')
}

describe('selectPaymentProvider', () => {
  it('uses Dodo when it is configured, even alongside Paddle', () => {
    withPaddle()
    expect(selectPaymentProvider({ ...DODO, NODE_ENV: 'production' }).kind).toBe('dodo')
  })

  it('keeps an existing Paddle-only deployment taking payments', () => {
    withPaddle()
    expect(selectPaymentProvider({ NODE_ENV: 'production' }).kind).toBe('paddle')
  })

  it('falls back to free demo claims in development', () => {
    vi.stubEnv('PADDLE_API_KEY', '')
    expect(selectPaymentProvider({ NODE_ENV: 'development' }).kind).toBe('demo')
  })

  it('closes checkout in production rather than handing out free territory', () => {
    // The fail-open this replaces: a production deploy missing a key gave every visitor free hexes.
    vi.stubEnv('PADDLE_API_KEY', '')
    expect(selectPaymentProvider({ NODE_ENV: 'production' }).kind).toBe('unconfigured')
  })
})

describe('isDemoModeAllowed', () => {
  it('is on outside production and off in it', () => {
    expect(isDemoModeAllowed({ NODE_ENV: 'development' })).toBe(true)
    expect(isDemoModeAllowed({ NODE_ENV: 'test' })).toBe(true)
    expect(isDemoModeAllowed({ NODE_ENV: 'production' })).toBe(false)
  })

  it('can be opted into in production, but only with the exact flag', () => {
    expect(isDemoModeAllowed({ NODE_ENV: 'production', ALLOW_DEMO_MODE: 'true' })).toBe(true)
    expect(isDemoModeAllowed({ NODE_ENV: 'production', ALLOW_DEMO_MODE: '1' })).toBe(false)
  })
})

describe('siteOrigin', () => {
  const request = new Request('http://internal-host:3000/api/checkout/create-session')

  it('prefers the configured public site URL', () => {
    expect(siteOrigin(request, { SITE_URL: 'https://hexwars.example/some/path' })).toBe('https://hexwars.example')
  })

  it('falls back to the request origin, including when SITE_URL is malformed', () => {
    expect(siteOrigin(request, {})).toBe('http://internal-host:3000')
    expect(siteOrigin(request, { SITE_URL: 'not a url' })).toBe('http://internal-host:3000')
  })
})
