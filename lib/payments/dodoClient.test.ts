import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHECKOUT_CURRENCY, createDodoCheckoutSession, isDodoCheckoutUrl, readDodoConfig } from './dodoClient'

const config = { apiKey: 'sk_test_123', productId: 'pdt_hex', live: false }
const input = {
  amountCents: 10_000,
  metadata: { hexIds: '["hex_0,0"]', quotedTotalCents: 10_000 },
  returnUrl: 'https://hexwars.test/checkout/complete',
  cancelUrl: 'https://hexwars.test/',
}

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async (..._args: unknown[]) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const okBody = { session_id: 'cks_1', checkout_url: 'https://test.checkout.dodopayments.com/session/cks_1' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createDodoCheckoutSession', () => {
  it('sends the server-computed amount to the test API, billed in dollars', async () => {
    const fetchMock = stubFetch(200, okBody)
    await createDodoCheckoutSession(input, config)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://test.dodopayments.com/checkouts')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_123')

    const body = JSON.parse(String(init.body))
    expect(body.product_cart).toEqual([{ product_id: 'pdt_hex', quantity: 1, amount: 10_000 }])
    expect(body.billing_currency).toBe(CHECKOUT_CURRENCY)
    expect(body.metadata).toEqual(input.metadata)
    expect(body.return_url).toBe(input.returnUrl)
    expect(body.cancel_url).toBe(input.cancelUrl)
  })

  it('talks to the live API only when configured for live mode', async () => {
    const fetchMock = stubFetch(200, { ...okBody, checkout_url: 'https://checkout.dodopayments.com/session/cks_1' })
    await createDodoCheckoutSession(input, { ...config, live: true })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://live.dodopayments.com/checkouts')
  })

  it('returns the session id and hosted checkout url', async () => {
    stubFetch(200, okBody)
    expect(await createDodoCheckoutSession(input, config)).toEqual({
      sessionId: 'cks_1',
      checkoutUrl: okBody.checkout_url,
    })
  })

  it('refuses to redirect a buyer anywhere but Dodo’s own checkout', async () => {
    stubFetch(200, { ...okBody, checkout_url: 'https://evil.example/pay' })
    await expect(createDodoCheckoutSession(input, config)).rejects.toThrow('Could not start checkout')
  })

  it('returns a generic error, never the provider’s detail, when Dodo refuses', async () => {
    stubFetch(422, { code: 'INVALID_AMOUNT', message: 'internal account detail' })
    await expect(createDodoCheckoutSession(input, config)).rejects.toThrow(/^Could not start checkout$/)
  })

  it('rejects a response missing the session fields', async () => {
    stubFetch(200, { unexpected: true })
    await expect(createDodoCheckoutSession(input, config)).rejects.toThrow('Could not start checkout')
  })

  it.each([0, -100, 10.5, Number.NaN])('never calls Dodo with an invalid amount (%s)', async (amountCents) => {
    const fetchMock = stubFetch(200, okBody)
    await expect(createDodoCheckoutSession({ ...input, amountCents }, config)).rejects.toThrow('Invalid checkout amount')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('readDodoConfig', () => {
  it('is null until both the API key and the product are set', () => {
    expect(readDodoConfig({})).toBeNull()
    expect(readDodoConfig({ DODO_PAYMENTS_API_KEY: 'k' })).toBeNull()
    expect(readDodoConfig({ DODO_PAYMENTS_PRODUCT_ID: 'p' })).toBeNull()
  })

  it('defaults to test mode — forgetting the setting must never take real money', () => {
    expect(readDodoConfig({ DODO_PAYMENTS_API_KEY: 'k', DODO_PAYMENTS_PRODUCT_ID: 'p' })?.live).toBe(false)
    expect(
      readDodoConfig({ DODO_PAYMENTS_API_KEY: 'k', DODO_PAYMENTS_PRODUCT_ID: 'p', DODO_PAYMENTS_ENVIRONMENT: 'live' })
        ?.live,
    ).toBe(false)
    expect(
      readDodoConfig({ DODO_PAYMENTS_API_KEY: 'k', DODO_PAYMENTS_PRODUCT_ID: 'p', DODO_PAYMENTS_ENVIRONMENT: 'live_mode' })
        ?.live,
    ).toBe(true)
  })
})

describe('isDodoCheckoutUrl', () => {
  it.each([
    ['https://checkout.dodopayments.com/session/1', true],
    ['https://test.checkout.dodopayments.com/session/1', true],
    ['http://checkout.dodopayments.com/session/1', false],
    ['https://dodopayments.com.evil.example/', false],
    ['https://evil.example/?next=dodopayments.com', false],
    ['javascript:alert(1)', false],
    ['', false],
  ])('%s → %s', (url, expected) => {
    expect(isDodoCheckoutUrl(url)).toBe(expected)
  })
})
