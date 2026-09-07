import { logger } from '@/lib/logger'

const LIVE_API_BASE = 'https://api.paddle.com'
const SANDBOX_API_BASE = 'https://sandbox-api.paddle.com'
const REQUEST_TIMEOUT_MS = 10_000

export type PaddleTransactionInput = {
  /** Total in cents. Computed server-side from current hex state — never sent by the client. */
  amountCents: number
  currencyCode: string
  /** Shown on the Paddle checkout and on the customer's receipt. */
  description: string
  /**
   * Echoed back verbatim on the webhook, so the handler knows what was bought without having to
   * re-derive buyer intent. Paddle's `custom_data` accepts a JSON object.
   */
  customData: Record<string, unknown>
  successUrl: string
}

export type PaddleTransaction = { id: string; checkoutUrl: string }

export type PaddleConfig = { apiKey: string; priceId: string; sandbox: boolean }

/**
 * Reads Paddle configuration, or null when it isn't set up.
 *
 * Null is a supported state, not an error: it puts the app in demo mode rather than breaking the
 * page, so the game is playable locally without credentials.
 */
export function readPaddleConfig(): PaddleConfig | null {
  const apiKey = process.env.PADDLE_API_KEY
  const priceId = process.env.PADDLE_PRICE_ID
  if (!apiKey || !priceId) return null

  return {
    apiKey,
    priceId,
    // Defaults to sandbox. Getting this backwards means taking real money in what you believe is a
    // test, so the safe value is the one you get by forgetting to set it.
    sandbox: process.env.PADDLE_ENVIRONMENT !== 'production',
  }
}

/**
 * Creates a Paddle Billing transaction and returns its hosted checkout URL.
 *
 * Built against Paddle's documented Billing API (`POST /transactions`). Worth noting versus the
 * Dodo integration this replaces: Paddle supports a per-item `unit_price` override alongside a
 * catalogue `price_id`, so a hex's price — which changes on every takeover — can be sent directly.
 * The Dodo integration had to fake variable pricing with a $0.01 product and a quantity equal to
 * the price in cents, which was a workaround for a missing field rather than a design.
 *
 * UNVERIFIED, confirm before going live: the exact response shape below (`data.id` and
 * `data.checkout.url`) is written from Paddle's documented Billing API, but has not been checked
 * against a live sandbox response from this account. Run one sandbox transaction and compare.
 */
export async function createPaddleTransaction(
  input: PaddleTransactionInput,
  config: PaddleConfig,
): Promise<PaddleTransaction> {
  const base = config.sandbox ? SANDBOX_API_BASE : LIVE_API_BASE

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${base}/transactions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        // Paddle pins request handling to an API version; sending it explicitly means their
        // rolling out a new default cannot silently change this integration's behaviour.
        'Paddle-Version': '1',
      },
      body: JSON.stringify({
        items: [
          {
            quantity: 1,
            price_id: config.priceId,
            // The whole reason this integration is simpler than the last one: the amount is sent
            // per transaction rather than pinned to a catalogue entry.
            unit_price: {
              amount: String(input.amountCents),
              currency_code: input.currencyCode,
            },
          },
        ],
        custom_data: input.customData,
        checkout: { url: input.successUrl },
        collection_mode: 'automatic',
      }),
    })

    const body = await response.json().catch(() => null)

    if (!response.ok) {
      // Paddle's error detail is logged but deliberately not returned to the caller — it can carry
      // account and configuration specifics that have no business reaching a browser.
      logger.error('Paddle transaction creation failed', {
        status: response.status,
        detail: body?.error?.detail ?? null,
      })
      throw new Error('Could not start checkout')
    }

    const id = body?.data?.id
    const checkoutUrl = body?.data?.checkout?.url
    if (typeof id !== 'string' || typeof checkoutUrl !== 'string') {
      logger.error('Paddle transaction response missing id or checkout url', { keys: Object.keys(body?.data ?? {}) })
      throw new Error('Could not start checkout')
    }

    return { id, checkoutUrl }
  } finally {
    clearTimeout(timeout)
  }
}
