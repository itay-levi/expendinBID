import { getDatabase, type Database } from '@/lib/db/client'

export type PaymentProvider = 'dodo' | 'paddle' | 'demo'

export type SettledPayment = {
  provider: PaymentProvider
  paymentId: string
  empireId: string
  amountCents: number
  currency: string
  hexIds: string[]
}

/**
 * The anti-fraud ledger: which payment bought what, and which domains may no longer buy.
 *
 * Payment providers report disputes by payment id alone. This is what turns that id back into a
 * buyer, so a chargeback on territory that was delivered as described blocks the domain that filed
 * it (Terms §7). Checkout consults the blocklist before creating a payment session.
 */
export type PaymentAuditRepository = {
  recordSettledPayment(payment: SettledPayment): Promise<void>
  findSettledPayment(provider: PaymentProvider, paymentId: string): Promise<SettledPayment | null>
  isDomainBlocked(domain: string): Promise<boolean>
  blockDomain(domain: string, reason: string, paymentId: string | null): Promise<void>
}

/**
 * Case-insensitive, and neither `www.` nor a trailing dot counts. Each is a way back in otherwise:
 * a buyer blocked as `brand.com` could return as `www.brand.com`, or as `brand.com.` — the fully
 * qualified form, which resolves to the same site but is a different string, and so a different
 * empire everywhere else in the app.
 */
export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '')
    .replace(/^www\./, '')
}

type SettledPaymentRow = {
  provider: PaymentProvider
  payment_id: string
  empire_id: string
  amount_cents: string | number
  currency: string
  hex_ids: string[]
}

export function createPostgresPaymentAuditRepository(db: Database = getDatabase()): PaymentAuditRepository {
  return {
    async recordSettledPayment(payment) {
      // Idempotent: a retried webhook records the same payment once.
      await db.query(
        `INSERT INTO settled_payments (provider, payment_id, empire_id, amount_cents, currency, hex_ids)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (provider, payment_id) DO NOTHING`,
        [payment.provider, payment.paymentId, payment.empireId, payment.amountCents, payment.currency, payment.hexIds],
      )
    },

    async findSettledPayment(provider, paymentId) {
      const { rows } = await db.query<SettledPaymentRow>(
        `SELECT provider, payment_id, empire_id, amount_cents, currency, hex_ids
           FROM settled_payments WHERE provider = $1 AND payment_id = $2`,
        [provider, paymentId],
      )
      const row = rows[0]
      if (!row) return null
      return {
        provider: row.provider,
        paymentId: row.payment_id,
        empireId: row.empire_id,
        amountCents: Number(row.amount_cents),
        currency: row.currency,
        hexIds: row.hex_ids,
      }
    },

    async isDomainBlocked(domain) {
      const { rows } = await db.query('SELECT 1 FROM blocked_domains WHERE domain = $1', [normalizeDomain(domain)])
      return rows.length > 0
    },

    async blockDomain(domain, reason, paymentId) {
      // First reason wins: a second dispute on an already-blocked domain changes nothing.
      await db.query(
        `INSERT INTO blocked_domains (domain, reason, payment_id) VALUES ($1, $2, $3)
         ON CONFLICT (domain) DO NOTHING`,
        [normalizeDomain(domain), reason, paymentId],
      )
    },
  }
}

/** Per-process stand-in for runs without a database. Lost on restart, like the rest of that mode. */
export function createInMemoryPaymentAuditRepository(): PaymentAuditRepository {
  const payments = new Map<string, SettledPayment>()
  const blocked = new Set<string>()
  return {
    async recordSettledPayment(payment) {
      const key = `${payment.provider}:${payment.paymentId}`
      if (!payments.has(key)) payments.set(key, payment)
    },
    async findSettledPayment(provider, paymentId) {
      return payments.get(`${provider}:${paymentId}`) ?? null
    },
    async isDomainBlocked(domain) {
      return blocked.has(normalizeDomain(domain))
    },
    async blockDomain(domain) {
      blocked.add(normalizeDomain(domain))
    },
  }
}
