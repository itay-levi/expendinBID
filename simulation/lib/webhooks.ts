import crypto from 'node:crypto'

/** A fresh Standard Webhooks secret. The simulator gives it to its private server at start-up. */
export function createWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('base64')}`
}

/**
 * Headers Dodo Payments would send: `webhook-id`, `webhook-timestamp` and a `v1,` HMAC-SHA256
 * signature over `${id}.${timestamp}.${body}` — the same scheme the app verifies.
 */
export function signedHeaders(
  secret: string,
  id: string,
  body: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const signature = crypto.createHmac('sha256', key).update(`${id}.${timestampSeconds}.${body}`).digest('base64')
  return {
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': String(timestampSeconds),
    'webhook-signature': `v1,${signature}`,
  }
}
