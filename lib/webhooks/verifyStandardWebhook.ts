import crypto from 'node:crypto'

/** The three headers a Standard Webhooks sender sets. All are required and all are signed. */
export type StandardWebhookHeaders = {
  id: string | null
  timestamp: string | null
  signature: string | null
}

export type StandardWebhookResult = { valid: true } | { valid: false; reason: string }

/**
 * Replay window. The spec leaves it to the receiver; five minutes matches the reference libraries
 * and survives ordinary clock drift while keeping a captured request useless soon after.
 */
export const STANDARD_WEBHOOK_TOLERANCE_SECONDS = 300

const SECRET_PREFIX = 'whsec_'
const SIGNATURE_VERSION = 'v1'

/** Secrets are base64, conventionally prefixed `whsec_`. Accepted with or without the prefix. */
function decodeSecret(secret: string): Buffer | null {
  const encoded = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null
  const key = Buffer.from(encoded, 'base64')
  return key.length > 0 ? key : null
}

/**
 * Verifies a webhook signed to the Standard Webhooks spec (https://www.standardwebhooks.com),
 * which is what Dodo Payments sends.
 *
 * The signed content is `${webhook-id}.${webhook-timestamp}.${rawBody}`, HMAC-SHA256'd with the
 * base64-decoded secret. `webhook-signature` is a space-separated list of `v1,<base64>` entries so
 * a sender can rotate keys without downtime — any one matching entry is enough.
 *
 * Signing the id and timestamp alongside the body is what makes both trustworthy: the id is the
 * idempotency key, and an attacker who could alter it could replay a real payment under a fresh id
 * and apply it twice.
 *
 * As with the Paddle verifier, the body must be the exact raw bytes received, and every comparison
 * is constant-time.
 */
export function verifyStandardWebhook(
  rawBody: string,
  headers: StandardWebhookHeaders,
  secret: string,
  now: Date = new Date(),
): StandardWebhookResult {
  if (!secret) return { valid: false, reason: 'Webhook secret is not configured' }

  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature) return { valid: false, reason: 'Missing webhook headers' }

  if (!/^\d{1,12}$/.test(timestamp)) return { valid: false, reason: 'Malformed webhook-timestamp' }

  // Checked before hashing so a flood of stale replays costs a subtraction, not an HMAC.
  const ageSeconds = Math.abs(now.getTime() / 1000 - Number(timestamp))
  if (ageSeconds > STANDARD_WEBHOOK_TOLERANCE_SECONDS) {
    return { valid: false, reason: 'Webhook timestamp outside the replay tolerance window' }
  }

  const key = decodeSecret(secret)
  if (!key) return { valid: false, reason: 'Webhook secret is malformed' }

  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest()

  for (const entry of signature.split(' ')) {
    const comma = entry.indexOf(',')
    if (comma === -1 || entry.slice(0, comma) !== SIGNATURE_VERSION) continue

    const provided = Buffer.from(entry.slice(comma + 1), 'base64')
    // timingSafeEqual throws on a length mismatch, so lengths are compared first.
    if (provided.length === expected.length && crypto.timingSafeEqual(provided, expected)) {
      return { valid: true }
    }
  }

  return { valid: false, reason: 'Signature mismatch' }
}
