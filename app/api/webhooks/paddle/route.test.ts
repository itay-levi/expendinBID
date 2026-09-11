import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetInMemoryHexes, inMemoryHexRepository } from '@/lib/repository/hexRepository'
import { fingerprintHexes } from '@/lib/hex/takeoverGuard'
import { hexIdFor } from '@/lib/hex/hexIdentity'

vi.mock('@/lib/brand/resolveBrandMetadata', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/brand/resolveBrandMetadata')>()
  return { ...actual, resolveBrandMetadataOrFallback: vi.fn(async (url: string) => actual.fallbackBrandMetadata(url)) }
})
vi.mock('@/lib/notifications/retaliationNotifier', () => ({ notifyDefenderOfTakeover: vi.fn(async () => undefined) }))

import { POST } from './route'

const SECRET = 'pdl_ntfset_test_secret'
const TILE = hexIdFor({ q: 90, r: -45 })
let sequence = 0

/** A delivery signed exactly the way Paddle signs one: ts=<unix>;h1=hex(hmac(secret, `${ts}:${body}`)). */
function delivery(event: object, { id = `evt_${++sequence}`, secret = SECRET } = {}): Request {
  const raw = JSON.stringify(event)
  const ts = String(Math.floor(Date.now() / 1000))
  const h1 = crypto.createHmac('sha256', secret).update(`${ts}:${raw}`).digest('hex')
  return new Request('http://localhost:3000/api/webhooks/paddle', {
    method: 'POST',
    headers: { 'paddle-signature': `ts=${ts};h1=${h1}`, 'paddle-event-id': id },
    body: raw,
  })
}

/** Connected open tiles: $10 for the first, $20 for the second, and so on. */
const quoteFor = (count: number) => (1_000 * count * (count + 1)) / 2

async function completedTransaction(
  domain: string,
  hexIds = [TILE],
  { paid = quoteFor(hexIds.length), currency = 'USD' } = {},
) {
  const found = await inMemoryHexRepository.getHexesByIds(hexIds)
  return {
    event_type: 'transaction.completed',
    data: {
      id: `txn_${domain}`,
      currency_code: currency,
      details: { totals: { total: String(paid), grand_total: String(paid) } },
      custom_data: {
        hexIds,
        targetUrl: `https://${domain}`,
        protect: false,
        primaryColorHex: '#635BFF',
        expectedHexState: JSON.stringify(fingerprintHexes(hexIds.map((id) => found.get(id)!))),
        quotedTotalCents: quoteFor(hexIds.length),
      },
    },
  }
}

beforeEach(() => {
  __resetInMemoryHexes([])
  vi.stubEnv('USE_IN_MEMORY_REPOSITORIES', '1')
  vi.stubEnv('PADDLE_WEBHOOK_SECRET', SECRET)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('POST /api/webhooks/paddle', () => {
  it('fails closed when no webhook secret is configured', async () => {
    vi.stubEnv('PADDLE_WEBHOOK_SECRET', '')
    expect((await POST(delivery(await completedTransaction('a.test')))).status).toBe(500)
  })

  it('rejects a delivery not signed with our secret, and grants nothing', async () => {
    const response = await POST(delivery(await completedTransaction('forger.test'), { secret: 'wrong' }))
    expect(response.status).toBe(401)
    expect((await inMemoryHexRepository.getHexById(TILE))?.ownerId).toBeNull()
  })

  it('settles a completed transaction', async () => {
    const response = await POST(delivery(await completedTransaction('paddle-buyer.test')))
    expect(response.status).toBe(200)
    expect((await inMemoryHexRepository.getHexById(TILE))?.ownerId).toBe('paddle-buyer.test')
  })

  it('records a multi-tile purchase at the price that was actually charged', async () => {
    // Two connected open tiles cost $10 + $20. The old webhook recorded them with a superseded
    // bulk formula; they must now be written as an even split of the real $30.
    const hexIds = [hexIdFor({ q: 90, r: -45 }), hexIdFor({ q: 91, r: -45 })]
    await POST(delivery(await completedTransaction('pair.test', hexIds)))
    for (const id of hexIds) {
      expect((await inMemoryHexRepository.getHexById(id))?.lastPricePaidCents).toBe(1_500)
    }
  })

  it('processes a redelivered event only once', async () => {
    const event = await completedTransaction('once.test')
    await POST(delivery(event, { id: 'evt_fixed' }))
    const second = await POST(delivery(event, { id: 'evt_fixed' }))
    expect(await second.json()).toMatchObject({ duplicate: true })
  })

  it('refuses territory when Paddle collected less than the quote', async () => {
    // A discount code or partial collection must never deliver territory for less than it costs.
    const response = await POST(delivery(await completedTransaction('cheap.test', [TILE], { paid: 1 })))
    expect(await response.json()).toMatchObject({ applied: false, reason: 'amount_mismatch' })
    expect((await inMemoryHexRepository.getHexById(TILE))?.ownerId).toBeNull()
  })

  it('refuses territory paid in a different currency than quoted', async () => {
    const event = await completedTransaction('eur.test', [TILE], { paid: 999_999, currency: 'EUR' })
    expect(await (await POST(delivery(event))).json()).toMatchObject({ reason: 'amount_mismatch' })
  })

  it('refuses a transaction that carries no quote to check against', async () => {
    const event = await completedTransaction('noquote.test')
    delete (event.data.custom_data as { quotedTotalCents?: number }).quotedTotalCents
    expect(await (await POST(delivery(event))).json()).toMatchObject({ reason: 'amount_mismatch' })
  })

  it('accepts a total that includes tax on top of the quote', async () => {
    const response = await POST(delivery(await completedTransaction('taxed.test', [TILE], { paid: 1_200 })))
    expect(response.status).toBe(200)
    expect((await inMemoryHexRepository.getHexById(TILE))?.ownerId).toBe('taxed.test')
  })

  it('acknowledges event types that do not grant territory', async () => {
    const response = await POST(delivery({ event_type: 'transaction.created', data: {} }))
    expect(await response.json()).toMatchObject({ received: true, ignored: 'transaction.created' })
  })

  it('hands the claim back when settlement fails, so Paddle’s retry is processed', async () => {
    const event = await completedTransaction('retry.test')
    vi.spyOn(inMemoryHexRepository, 'getHexesByIds').mockRejectedValueOnce(new Error('database blip'))

    expect((await POST(delivery(event, { id: 'evt_retry' }))).status).toBe(500)
    // Before the fix, this retry was discarded as a duplicate and the buyer paid for nothing.
    const retry = await POST(delivery(event, { id: 'evt_retry' }))
    expect(retry.status).toBe(200)
    expect((await inMemoryHexRepository.getHexById(TILE))?.ownerId).toBe('retry.test')
  })

  it('refuses to apply a purchase whose tiles changed hands while it was being paid', async () => {
    const event = await completedTransaction('late.test')
    __resetInMemoryHexes([{ ...(await inMemoryHexRepository.getHexById(TILE))!, ownerId: 'faster.test' }])
    const response = await POST(delivery(event))
    expect(await response.json()).toMatchObject({ applied: false, reason: 'state_conflict' })
    expect((await inMemoryHexRepository.getHexById(TILE))?.ownerId).toBe('faster.test')
  })
})
