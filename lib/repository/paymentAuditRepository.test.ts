import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  createInMemoryPaymentAuditRepository,
  createPostgresPaymentAuditRepository,
  normalizeDomain,
  type PaymentAuditRepository,
} from './paymentAuditRepository'
import type { Database } from '@/lib/db/client'

/** Real Postgres (PGlite), with both migrations applied, so the constraints are the real ones. */
let pglite: PGlite
let postgres: PaymentAuditRepository

beforeAll(async () => {
  pglite = new PGlite()
  const db = {
    driver: 'pglite',
    async query(text: string, params?: unknown[]) {
      const result = await pglite.query(text, params)
      return { rows: result.rows as never[] }
    },
    async exec(sql: string) {
      await pglite.exec(sql)
    },
    async transaction() {
      throw new Error('not used by this repository')
    },
    async close() {
      await pglite.close()
    },
  } as unknown as Database

  for (const file of ['0001_init.sql', '0002_payments_and_blocklist.sql']) {
    await pglite.exec(await readFile(path.join(process.cwd(), 'db', 'migrations', file), 'utf-8'))
  }
  postgres = createPostgresPaymentAuditRepository(db)
})

afterAll(async () => {
  await pglite.close()
})

beforeEach(async () => {
  await pglite.exec('TRUNCATE settled_payments, blocked_domains, hexes, takeover_events, empires CASCADE')
  await pglite.query(`INSERT INTO empires (id, domain, url, name) VALUES ('buyer.com','buyer.com','https://buyer.com','Buyer')`)
})

const payment = {
  provider: 'dodo' as const,
  paymentId: 'pay_1',
  empireId: 'buyer.com',
  amountCents: 10_000,
  currency: 'USD',
  hexIds: ['hex_0,0', 'hex_1,0'],
}

describe.each([
  ['postgres', () => postgres],
  ['in-memory', () => createInMemoryPaymentAuditRepository()],
])('%s payment audit', (_name, make) => {
  it('records a settled payment and finds it by provider and id', async () => {
    const repository = make()
    await repository.recordSettledPayment(payment)
    expect(await repository.findSettledPayment('dodo', 'pay_1')).toEqual(payment)
    // Provider is part of the identity: the same id from another provider is a different payment.
    expect(await repository.findSettledPayment('paddle', 'pay_1')).toBeNull()
  })

  it('records a retried payment once', async () => {
    const repository = make()
    await repository.recordSettledPayment(payment)
    await repository.recordSettledPayment({ ...payment, amountCents: 1 })
    expect((await repository.findSettledPayment('dodo', 'pay_1'))?.amountCents).toBe(10_000)
  })

  it('blocks a domain regardless of case, a www. prefix or a trailing dot', async () => {
    const repository = make()
    expect(await repository.isDomainBlocked('buyer.com')).toBe(false)
    await repository.blockDomain('WWW.Buyer.com', 'chargeback', 'pay_1')
    // `buyer.com.` is the fully-qualified form of the same site — the bypass a reviewer found.
    for (const variant of ['buyer.com', 'www.buyer.com', 'BUYER.COM', 'buyer.com.', 'www.buyer.com..']) {
      expect(await repository.isDomainBlocked(variant)).toBe(true)
    }
    expect(await repository.isDomainBlocked('other.com')).toBe(false)
  })

  it('treats blocking an already-blocked domain as a no-op', async () => {
    const repository = make()
    await repository.blockDomain('buyer.com', 'chargeback', 'pay_1')
    await expect(repository.blockDomain('buyer.com', 'chargeback', 'pay_2')).resolves.toBeUndefined()
  })
})

describe('normalizeDomain', () => {
  it('lowercases, trims and drops a leading www.', () => {
    expect(normalizeDomain('  WWW.Example.COM ')).toBe('example.com')
    // Only a leading www. — a subdomain that merely contains it is its own domain.
    expect(normalizeDomain('shop.www.example.com')).toBe('shop.www.example.com')
  })
})
