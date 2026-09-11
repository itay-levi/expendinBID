import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleDodoWebhook, readDodoTakeoverMetadata } from './dodoWebhook'
import { __resetInMemoryHexes, inMemoryHexRepository } from '@/lib/repository/hexRepository'
import { inMemoryEmpireRepository } from '@/lib/repository/empireRepository'
import { createInMemoryLedgerRepository } from '@/lib/repository/ledgerRepository'
import { createInMemoryPaymentAuditRepository } from '@/lib/repository/paymentAuditRepository'
import { fingerprintHexes } from '@/lib/hex/takeoverGuard'
import { hexIdFor } from '@/lib/hex/hexIdentity'
import type { Repositories } from '@/lib/repository'

vi.mock('@/lib/notifications/retaliationNotifier', () => ({ notifyDefenderOfTakeover: vi.fn(async () => undefined) }))

const KEY = Buffer.from('dodo-test-webhook-signing-key-0000000', 'utf-8')
const SECRET = `whsec_${KEY.toString('base64')}`
const NOW = new Date('2026-09-11T12:00:00.000Z')

let repositories: Repositories
let sequence = 0

function signed(event: object, id = `msg_${++sequence}`) {
  const raw = JSON.stringify(event)
  const timestamp = String(Math.floor(NOW.getTime() / 1000))
  const signature = crypto.createHmac('sha256', KEY).update(`${id}.${timestamp}.${raw}`).digest('base64')
  return { raw, headers: { id, timestamp, signature: `v1,${signature}` } }
}

const deps = () => ({
  secret: SECRET,
  getRepositories: async () => repositories,
  resolveMetadata: async (url: string) => ({
    title: 'Buyer',
    description: 'Buyer Co',
    logoUrl: 'https://buyer.test/logo.png',
    sourceUrl: url,
  }),
  now: NOW,
})

/** A payment.succeeded event exactly as checkout would have set it up for these tiles. */
async function paymentEvent(domain: string, hexIds: string[], overrides: Record<string, unknown> = {}) {
  const found = await inMemoryHexRepository.getHexesByIds(hexIds)
  const quoted = 1_000 * hexIds.length * (hexIds.length + 1) / 2
  return {
    type: 'payment.succeeded',
    data: {
      payment_id: `pay_${domain}`,
      status: 'succeeded',
      total_amount: quoted,
      currency: 'USD',
      metadata: {
        hexIds: JSON.stringify(hexIds),
        targetUrl: `https://${domain}`,
        protect: false,
        primaryColorHex: '#635BFF',
        expectedHexState: JSON.stringify(fingerprintHexes(hexIds.map((id) => found.get(id)!))),
        quotedTotalCents: quoted,
      },
      ...overrides,
    },
  }
}

beforeEach(() => {
  __resetInMemoryHexes([])
  repositories = {
    hexes: inMemoryHexRepository,
    empires: inMemoryEmpireRepository,
    ledger: createInMemoryLedgerRepository(),
    audit: createInMemoryPaymentAuditRepository(),
  }
})

const tile = hexIdFor({ q: 30, r: -30 })

describe('handleDodoWebhook', () => {
  it('rejects a delivery that is not signed with our secret', async () => {
    const { raw, headers } = signed(await paymentEvent('forger.test', [tile]))
    const outcome = await handleDodoWebhook(raw, { ...headers, signature: 'v1,Zm9yZ2Vk' }, deps())
    expect(outcome.status).toBe(401)
    expect((await inMemoryHexRepository.getHexById(tile))?.ownerId).toBeNull()
  })

  it('fails closed when no secret is configured', async () => {
    const { raw, headers } = signed(await paymentEvent('a.test', [tile]))
    expect((await handleDodoWebhook(raw, headers, { ...deps(), secret: undefined })).status).toBe(500)
  })

  it('settles a paid purchase and records the payment for later disputes', async () => {
    const { raw, headers } = signed(await paymentEvent('paid.test', [tile]))
    const outcome = await handleDodoWebhook(raw, headers, deps())

    expect(outcome).toEqual({ status: 200, body: { received: true, applied: true } })
    expect((await inMemoryHexRepository.getHexById(tile))?.ownerId).toBe('paid.test')
    expect(await repositories.audit.findSettledPayment('dodo', 'pay_paid.test')).toMatchObject({
      empireId: 'paid.test',
      amountCents: 1_000,
      hexIds: [tile],
    })
  })

  it('processes a redelivered event only once', async () => {
    const delivery = signed(await paymentEvent('once.test', [tile]))
    await handleDodoWebhook(delivery.raw, delivery.headers, deps())
    const second = await handleDodoWebhook(delivery.raw, delivery.headers, deps())
    expect(second.body).toMatchObject({ duplicate: true })
  })

  it('refuses territory when the amount paid is less than the quote', async () => {
    const event = await paymentEvent('cheap.test', [tile], { total_amount: 1 })
    const { raw, headers } = signed(event)
    const outcome = await handleDodoWebhook(raw, headers, deps())
    expect(outcome.body).toMatchObject({ applied: false, reason: 'amount_mismatch' })
    expect((await inMemoryHexRepository.getHexById(tile))?.ownerId).toBeNull()
  })

  it('refuses territory when paid in a different currency than quoted', async () => {
    const { raw, headers } = signed(await paymentEvent('inr.test', [tile], { currency: 'INR', total_amount: 999_999 }))
    expect((await handleDodoWebhook(raw, headers, deps())).body).toMatchObject({ reason: 'amount_mismatch' })
  })

  it('accepts a total that includes tax on top of the quote', async () => {
    const { raw, headers } = signed(await paymentEvent('taxed.test', [tile], { total_amount: 1_200 }))
    expect((await handleDodoWebhook(raw, headers, deps())).body).toMatchObject({ applied: true })
  })

  it('blocks the buyer after a chargeback, including the www. form of their domain', async () => {
    const paid = signed(await paymentEvent('disputer.test', [tile]))
    await handleDodoWebhook(paid.raw, paid.headers, deps())

    const dispute = signed({ type: 'dispute.opened', data: { payment_id: 'pay_disputer.test' } })
    const outcome = await handleDodoWebhook(dispute.raw, dispute.headers, deps())

    expect(outcome.body).toMatchObject({ blocked: true })
    expect(await repositories.audit.isDomainBlocked('disputer.test')).toBe(true)
    expect(await repositories.audit.isDomainBlocked('WWW.Disputer.test')).toBe(true)
  })

  it('does not block anyone over a dispute on a payment it never settled', async () => {
    const dispute = signed({ type: 'dispute.opened', data: { payment_id: 'pay_unknown' } })
    const outcome = await handleDodoWebhook(dispute.raw, dispute.headers, deps())
    expect(outcome.status).toBe(200)
    expect(outcome.body).not.toHaveProperty('blocked')
  })

  it('hands the claim back when processing fails, so the retry is not dropped as a duplicate', async () => {
    const delivery = signed(await paymentEvent('retry.test', [tile]))
    const realLookup = inMemoryHexRepository.getHexesByIds
    const failOnce = vi
      .spyOn(inMemoryHexRepository, 'getHexesByIds')
      .mockRejectedValueOnce(new Error('database blip'))

    const first = await handleDodoWebhook(delivery.raw, delivery.headers, deps())
    expect(first.status).toBe(500)

    const retry = await handleDodoWebhook(delivery.raw, delivery.headers, deps())
    expect(retry.body).toMatchObject({ applied: true })
    failOnce.mockRestore()
    expect(inMemoryHexRepository.getHexesByIds).toBe(realLookup)
  })

  it('acknowledges but does not settle a payment without usable metadata', async () => {
    const { raw, headers } = signed({ type: 'payment.succeeded', data: { payment_id: 'pay_x', metadata: {} } })
    expect((await handleDodoWebhook(raw, headers, deps())).body).toMatchObject({ reason: 'missing_metadata' })
  })

  it('acknowledges event types it does not handle', async () => {
    const { raw, headers } = signed({ type: 'subscription.active', data: {} })
    expect((await handleDodoWebhook(raw, headers, deps())).body).toMatchObject({ ignored: 'subscription.active' })
  })
})

describe('readDodoTakeoverMetadata', () => {
  const valid = {
    hexIds: JSON.stringify(['hex_0,0']),
    targetUrl: 'https://brand.test',
    quotedTotalCents: 1_000,
    expectedHexState: '[]',
  }

  it('accepts what checkout writes', () => {
    expect(readDodoTakeoverMetadata(valid)).toMatchObject({ hexIds: ['hex_0,0'], protect: false })
  })

  it.each([
    ['a non-web target', { ...valid, targetUrl: 'javascript:alert(1)' }],
    ['an unparseable target', { ...valid, targetUrl: 'not a url' }],
    ['an empty basket', { ...valid, hexIds: '[]' }],
    ['a basket that is not JSON', { ...valid, hexIds: '[oops' }],
    ['non-string tile ids', { ...valid, hexIds: '[1,2]' }],
    ['a fractional quote', { ...valid, quotedTotalCents: 10.5 }],
    ['a zero quote', { ...valid, quotedTotalCents: 0 }],
  ])('rejects %s', (_label, metadata) => {
    expect(readDodoTakeoverMetadata(metadata)).toBeNull()
  })

  it('reads protect from either a boolean or its string form', () => {
    expect(readDodoTakeoverMetadata({ ...valid, protect: 'true' })?.protect).toBe(true)
    expect(readDodoTakeoverMetadata({ ...valid, protect: true })?.protect).toBe(true)
  })
})
