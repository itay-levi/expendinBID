import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Webhook } from 'standardwebhooks'
import { STANDARD_WEBHOOK_TOLERANCE_SECONDS, verifyStandardWebhook } from './verifyStandardWebhook'

const RAW_KEY = Buffer.from('hex-wars-test-signing-key-32-bytes!!', 'utf-8')
const SECRET = `whsec_${RAW_KEY.toString('base64')}`
const NOW = new Date('2026-09-11T12:00:00.000Z')
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1000))
const ID = 'msg_2KWPBgLlAfxdpx2AI54pPJ85f4W'
const BODY = JSON.stringify({ type: 'payment.succeeded', data: { payment_id: 'pay_123', total_amount: 10000 } })

function sign(id: string, timestamp: string, body: string, key: Buffer = RAW_KEY): string {
  return `v1,${crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`
}

const headers = (signature: string, overrides: Partial<{ id: string; timestamp: string }> = {}) => ({
  id: overrides.id ?? ID,
  timestamp: overrides.timestamp ?? TIMESTAMP,
  signature,
})

describe('verifyStandardWebhook', () => {
  it('accepts a correctly signed delivery', () => {
    expect(verifyStandardWebhook(BODY, headers(sign(ID, TIMESTAMP, BODY)), SECRET, NOW)).toEqual({ valid: true })
  })

  it('agrees with the reference Standard Webhooks implementation', () => {
    // The strongest compatibility check available offline: a signature produced by the spec's own
    // library must verify here. If this ever fails, real deliveries would be rejected in production.
    const reference = new Webhook(SECRET).sign(ID, NOW, BODY)
    expect(verifyStandardWebhook(BODY, headers(reference), SECRET, NOW)).toEqual({ valid: true })
  })

  it('accepts the secret without its whsec_ prefix', () => {
    const bare = RAW_KEY.toString('base64')
    expect(verifyStandardWebhook(BODY, headers(sign(ID, TIMESTAMP, BODY)), bare, NOW).valid).toBe(true)
  })

  it('rejects a body altered after signing', () => {
    const tampered = BODY.replace('10000', '1')
    expect(verifyStandardWebhook(tampered, headers(sign(ID, TIMESTAMP, BODY)), SECRET, NOW)).toEqual({
      valid: false,
      reason: 'Signature mismatch',
    })
  })

  it('rejects a replayed delivery under a new id', () => {
    // The id is signed precisely so it cannot be swapped to dodge idempotency.
    const signature = sign(ID, TIMESTAMP, BODY)
    expect(verifyStandardWebhook(BODY, headers(signature, { id: 'msg_forged' }), SECRET, NOW).valid).toBe(false)
  })

  it('rejects a signature made with a different secret', () => {
    const other = sign(ID, TIMESTAMP, BODY, Buffer.from('some-other-key-entirely-000000000'))
    expect(verifyStandardWebhook(BODY, headers(other), SECRET, NOW).valid).toBe(false)
  })

  it('rejects deliveries outside the tolerance window, in either direction', () => {
    const tooOld = String(Number(TIMESTAMP) - STANDARD_WEBHOOK_TOLERANCE_SECONDS - 1)
    const tooNew = String(Number(TIMESTAMP) + STANDARD_WEBHOOK_TOLERANCE_SECONDS + 1)
    for (const timestamp of [tooOld, tooNew]) {
      const result = verifyStandardWebhook(BODY, headers(sign(ID, timestamp, BODY), { timestamp }), SECRET, NOW)
      expect(result).toEqual({ valid: false, reason: 'Webhook timestamp outside the replay tolerance window' })
    }
  })

  it('accepts a delivery right at the edge of the window', () => {
    const edge = String(Number(TIMESTAMP) - STANDARD_WEBHOOK_TOLERANCE_SECONDS)
    expect(verifyStandardWebhook(BODY, headers(sign(ID, edge, BODY), { timestamp: edge }), SECRET, NOW).valid).toBe(
      true,
    )
  })

  it('accepts when any one of several rotated signatures matches', () => {
    const stale = sign(ID, TIMESTAMP, BODY, Buffer.from('retired-key-retired-key-retired!!'))
    const list = `${stale} v1a,notreal ${sign(ID, TIMESTAMP, BODY)}`
    expect(verifyStandardWebhook(BODY, headers(list), SECRET, NOW).valid).toBe(true)
  })

  it('ignores entries with an unknown version prefix', () => {
    const valueOnly = sign(ID, TIMESTAMP, BODY).slice(3)
    expect(verifyStandardWebhook(BODY, headers(`v2,${valueOnly}`), SECRET, NOW).valid).toBe(false)
  })

  it('fails closed on missing headers, malformed timestamps and an unset secret', () => {
    const good = sign(ID, TIMESTAMP, BODY)
    expect(verifyStandardWebhook(BODY, { id: null, timestamp: TIMESTAMP, signature: good }, SECRET, NOW).valid).toBe(
      false,
    )
    expect(verifyStandardWebhook(BODY, { id: ID, timestamp: null, signature: good }, SECRET, NOW).valid).toBe(false)
    expect(verifyStandardWebhook(BODY, { id: ID, timestamp: TIMESTAMP, signature: null }, SECRET, NOW).valid).toBe(
      false,
    )
    expect(verifyStandardWebhook(BODY, headers(good, { timestamp: '12e9' }), SECRET, NOW).valid).toBe(false)
    expect(verifyStandardWebhook(BODY, headers(good), '', NOW)).toEqual({
      valid: false,
      reason: 'Webhook secret is not configured',
    })
  })

  it('rejects a malformed secret rather than hashing with garbage', () => {
    expect(verifyStandardWebhook(BODY, headers(sign(ID, TIMESTAMP, BODY)), 'whsec_***', NOW)).toEqual({
      valid: false,
      reason: 'Webhook secret is malformed',
    })
  })

  it('rejects a truncated signature without throwing', () => {
    expect(() => verifyStandardWebhook(BODY, headers('v1,AAAA'), SECRET, NOW)).not.toThrow()
    expect(verifyStandardWebhook(BODY, headers('v1,AAAA'), SECRET, NOW).valid).toBe(false)
  })
})
