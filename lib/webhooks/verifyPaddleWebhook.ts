import crypto from 'node:crypto'

export type PaddleVerificationResult = { valid: true } | { valid: false; reason: string }

/**
 * Replay tolerance. Paddle's own guidance is 5 seconds, but that is tight enough that ordinary
 * clock skew between their servers and ours starts rejecting genuine deliveries. 5 minutes keeps
 * the replay window short while surviving a machine whose NTP has drifted.
 */
export const PADDLE_REPLAY_TOLERANCE_SECONDS = 300

/**
 * Verifies a Paddle Billing webhook signature.
 *
 * This is the single most important check in the payments path. Without it, anyone who knows the
 * endpoint URL can POST a "transaction.completed" body and take hexes for free — the webhook is
 * the only place ownership actually changes.
 *
 * Paddle's scheme: the `Paddle-Signature` header carries `ts=<unix seconds>;h1=<hex hmac>`, and
 * the signed payload is `${ts}:${rawBody}` HMAC-SHA256'd with the notification destination's
 * secret key.
 *
 * Two details that are easy to get wrong and fatal if you do:
 *   * the RAW body must be hashed, byte for byte. Parsing to JSON and re-serialising changes key
 *     order and whitespace, and the signature will never match.
 *   * comparison is `timingSafeEqual`, never `===`. A plain comparison exits at the first
 *     differing byte, which leaks how much of a guessed signature was correct and turns forgery
 *     into a few thousand requests.
 */
export function verifyPaddleWebhook(
  rawBody: string,
  signatureHeader: string | null,
  secretKey: string,
  now: Date = new Date(),
): PaddleVerificationResult {
  if (!secretKey) return { valid: false, reason: 'Webhook secret is not configured' }
  if (!signatureHeader) return { valid: false, reason: 'Missing Paddle-Signature header' }

  const parts = new Map<string, string>()
  for (const segment of signatureHeader.split(';')) {
    const separator = segment.indexOf('=')
    if (separator === -1) continue
    parts.set(segment.slice(0, separator).trim(), segment.slice(separator + 1).trim())
  }

  const timestamp = parts.get('ts')
  const providedSignature = parts.get('h1')
  if (!timestamp || !providedSignature) {
    return { valid: false, reason: 'Malformed Paddle-Signature header' }
  }

  const timestampSeconds = Number(timestamp)
  if (!Number.isFinite(timestampSeconds)) {
    return { valid: false, reason: 'Malformed timestamp in Paddle-Signature header' }
  }

  // Checked before the HMAC so a flood of stale replays costs a subtraction rather than a hash.
  const ageSeconds = Math.abs(now.getTime() / 1000 - timestampSeconds)
  if (ageSeconds > PADDLE_REPLAY_TOLERANCE_SECONDS) {
    return { valid: false, reason: 'Webhook timestamp outside the replay tolerance window' }
  }

  const expected = crypto
    .createHmac('sha256', secretKey)
    .update(`${timestamp}:${rawBody}`)
    .digest('hex')

  const expectedBuffer = Buffer.from(expected, 'hex')
  const providedBuffer = Buffer.from(providedSignature, 'hex')

  // timingSafeEqual throws on a length mismatch, which would itself be a (crude) oracle — so the
  // lengths are compared first and a mismatch reported as a plain invalid signature.
  if (expectedBuffer.length !== providedBuffer.length || providedBuffer.length === 0) {
    return { valid: false, reason: 'Signature mismatch' }
  }
  if (!crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return { valid: false, reason: 'Signature mismatch' }
  }

  return { valid: true }
}
