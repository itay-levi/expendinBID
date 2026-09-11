import { logger } from '@/lib/logger'

const LIVE_API_BASE = 'https://live.dodopayments.com'
const TEST_API_BASE = 'https://test.dodopayments.com'
const REQUEST_TIMEOUT_MS = 10_000

/**
 * Every price on the site is in US dollars, so every session is billed in them. Fixed on the
 * session rather than left to the account default, which lets the webhook compare the amount paid
 * against the quote like for like.
 */
export const CHECKOUT_CURRENCY = 'USD'

export type DodoConfig = { apiKey: string; productId: string; live: boolean }

/**
 * Reads Dodo Payments configuration, or null when it isn't set up.
 *
 * Test mode unless DODO_PAYMENTS_ENVIRONMENT is exactly `live_mode`: the value you get by
 * forgetting to set it must never be the one that takes real money.
 */
/** Anything shaped like process.env. Lets tests pass a plain object without Next's required keys. */
export type EnvSource = Readonly<Record<string, string | undefined>>

export function readDodoConfig(env: EnvSource = process.env): DodoConfig | null {
  const apiKey = env.DODO_PAYMENTS_API_KEY?.trim()
  const productId = env.DODO_PAYMENTS_PRODUCT_ID?.trim()
  if (!apiKey || !productId) return null
  return { apiKey, productId, live: env.DODO_PAYMENTS_ENVIRONMENT === 'live_mode' }
}

/** Dodo's metadata is flat — string, number or boolean values only. */
export type DodoMetadata = Record<string, string | number | boolean>

export type DodoCheckoutInput = {
  /** Total in cents. Computed server-side from current hex state — never sent by the client. */
  amountCents: number
  /** Echoed back on the payment webhook, so settlement knows what was bought. */
  metadata: DodoMetadata
  returnUrl: string
  cancelUrl: string
}

export type DodoCheckoutSession = { sessionId: string; checkoutUrl: string }

/**
 * A redirect target is only ever Dodo's own hosted checkout, over https.
 *
 * Checked even though the URL comes from Dodo's API: this value is sent straight to the buyer's
 * browser as a redirect, and trusting it blindly would turn any upstream misconfiguration into an
 * open redirect on a payment button.
 */
export function isDodoCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'dodopayments.com' || url.hostname.endsWith('.dodopayments.com'))
  } catch {
    return false
  }
}

/**
 * Creates a hosted Dodo checkout session for a server-computed amount.
 *
 * The product must be a one-time "Pay What You Want" product: that is what lets `amount` on the
 * cart item set the price per session, which a hex needs because its price changes on every
 * takeover. The customer cannot change an amount the session was created with.
 */
export async function createDodoCheckoutSession(
  input: DodoCheckoutInput,
  config: DodoConfig,
): Promise<DodoCheckoutSession> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('Invalid checkout amount')
  }

  const base = config.live ? LIVE_API_BASE : TEST_API_BASE
  const response = await fetch(`${base}/checkouts`, {
    method: 'POST',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      product_cart: [{ product_id: config.productId, quantity: 1, amount: input.amountCents }],
      return_url: input.returnUrl,
      cancel_url: input.cancelUrl,
      billing_currency: CHECKOUT_CURRENCY,
      metadata: input.metadata,
    }),
  })

  const body: unknown = await response.json().catch(() => null)
  const payload = (body ?? {}) as { session_id?: unknown; checkout_url?: unknown; code?: unknown }

  if (!response.ok) {
    // Logged, never returned: provider errors can carry account and configuration details.
    logger.error('Dodo checkout session creation failed', { status: response.status, code: payload.code ?? null })
    throw new Error('Could not start checkout')
  }

  if (typeof payload.session_id !== 'string' || typeof payload.checkout_url !== 'string') {
    logger.error('Dodo checkout response missing session id or checkout url', { keys: Object.keys(payload) })
    throw new Error('Could not start checkout')
  }

  if (!isDodoCheckoutUrl(payload.checkout_url)) {
    logger.error('Dodo returned a checkout url outside dodopayments.com — refusing to redirect')
    throw new Error('Could not start checkout')
  }

  return { sessionId: payload.session_id, checkoutUrl: payload.checkout_url }
}
