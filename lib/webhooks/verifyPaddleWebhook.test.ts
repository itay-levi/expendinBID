import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { PADDLE_REPLAY_TOLERANCE_SECONDS, verifyPaddleWebhook } from './verifyPaddleWebhook'

const SECRET = 'pdl_ntfset_01hv8...testsecret'
const BODY = JSON.stringify({ event_type: 'transaction.completed', data: { id: 'txn_123' } })
const NOW = new Date('2026-09-06T12:00:00.000Z')

/** Signs exactly the way Paddle documents, so these assertions test our code, not a shared helper. */
function sign(body: string, timestampSeconds: number, secret = SECRET): string {
  const h1 = crypto.createHmac('sha256', secret).update(`${timestampSeconds}:${body}`).digest('hex')
  return `ts=${timestampSeconds};h1=${h1}`
}

const currentTs = Math.floor(NOW.getTime() / 1000)

describe('verifyPaddleWebhook', () => {
  it('accepts a correctly signed, current payload', () => {
    expect(verifyPaddleWebhook(BODY, sign(BODY, currentTs), SECRET, NOW)).toEqual({ valid: true })
  })

  it('rejects a payload signed with the wrong secret', () => {
    const forged = sign(BODY, currentTs, 'attacker-guess')
    expect(verifyPaddleWebhook(BODY, forged, SECRET, NOW).valid).toBe(false)
  })

  it('rejects a body modified after signing', () => {
    // The attack this exists to stop: take a real delivery and rewrite which hexes it grants.
    const header = sign(BODY, currentTs)
    const tampered = JSON.stringify({ event_type: 'transaction.completed', data: { id: 'txn_evil' } })
    expect(verifyPaddleWebhook(tampered, header, SECRET, NOW).valid).toBe(false)
  })

  it('rejects a signature valid for a different timestamp', () => {
    // Correct HMAC over a different ts must not validate under the ts actually presented.
    const h1 = crypto.createHmac('sha256', SECRET).update(`${currentTs - 10}:${BODY}`).digest('hex')
    expect(verifyPaddleWebhook(BODY, `ts=${currentTs};h1=${h1}`, SECRET, NOW).valid).toBe(false)
  })

  it('rejects a replayed delivery from outside the tolerance window', () => {
    const stale = currentTs - PADDLE_REPLAY_TOLERANCE_SECONDS - 1
    const result = verifyPaddleWebhook(BODY, sign(BODY, stale), SECRET, NOW)
    expect(result).toEqual({ valid: false, reason: 'Webhook timestamp outside the replay tolerance window' })
  })

  it('accepts a delivery at the edge of the tolerance window', () => {
    const edge = currentTs - PADDLE_REPLAY_TOLERANCE_SECONDS + 1
    expect(verifyPaddleWebhook(BODY, sign(BODY, edge), SECRET, NOW).valid).toBe(true)
  })

  it('rejects a timestamp from the future beyond tolerance, not just the past', () => {
    const future = currentTs + PADDLE_REPLAY_TOLERANCE_SECONDS + 60
    expect(verifyPaddleWebhook(BODY, sign(BODY, future), SECRET, NOW).valid).toBe(false)
  })

  it('rejects a missing or malformed header', () => {
    expect(verifyPaddleWebhook(BODY, null, SECRET, NOW).valid).toBe(false)
    expect(verifyPaddleWebhook(BODY, '', SECRET, NOW).valid).toBe(false)
    expect(verifyPaddleWebhook(BODY, 'garbage', SECRET, NOW).valid).toBe(false)
    expect(verifyPaddleWebhook(BODY, `ts=${currentTs}`, SECRET, NOW).valid).toBe(false)
    expect(verifyPaddleWebhook(BODY, 'h1=abc', SECRET, NOW).valid).toBe(false)
    expect(verifyPaddleWebhook(BODY, `ts=notanumber;h1=abc`, SECRET, NOW).valid).toBe(false)
  })

  it('rejects an empty signature rather than treating it as a match', () => {
    expect(verifyPaddleWebhook(BODY, `ts=${currentTs};h1=`, SECRET, NOW).valid).toBe(false)
  })

  it('rejects a truncated signature of the wrong length', () => {
    const full = sign(BODY, currentTs).split('h1=')[1] as string
    expect(verifyPaddleWebhook(BODY, `ts=${currentTs};h1=${full.slice(0, 20)}`, SECRET, NOW).valid).toBe(false)
  })

  it('refuses to verify at all when no secret is configured — fail closed', () => {
    // Never treat "unconfigured" as "allowed": that turns a missing env var into free hexes.
    const result = verifyPaddleWebhook(BODY, sign(BODY, currentTs), '', NOW)
    expect(result).toEqual({ valid: false, reason: 'Webhook secret is not configured' })
  })

  it('tolerates whitespace around header segments', () => {
    const header = sign(BODY, currentTs).replace(';', '; ')
    expect(verifyPaddleWebhook(BODY, header, SECRET, NOW).valid).toBe(true)
  })

  it('is sensitive to raw-body bytes, not parsed equivalence', () => {
    // Same JSON value, different serialisation. Signing must be over the exact bytes received,
    // which is why the route reads request.text() and never request.json().
    const header = sign(BODY, currentTs)
    const reserialised = JSON.stringify(JSON.parse(BODY), null, 2)
    expect(verifyPaddleWebhook(reserialised, header, SECRET, NOW).valid).toBe(false)
  })
})
