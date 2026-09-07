import { getDatabase, type Database } from '@/lib/db/client'
import type { MarketSnapshot, TakeoverEvent } from '@/types/game'
import { hexIdFor } from '@/lib/hex/hexIdentity'

export type LedgerRepository = {
  /** Aggregate market figures, derived from the ledger — never stored counters that can drift. */
  getMarketSnapshot(): Promise<MarketSnapshot>
  /** Most recent takeovers, newest first, for the live ticker. */
  getRecentTakeovers(limit: number): Promise<TakeoverEvent[]>
  /**
   * Claims a webhook id, returning false if it was already processed.
   *
   * The return value is the idempotency decision, and it comes from a unique-constraint conflict
   * rather than a prior "have I seen this?" read. That distinction is the whole point: two
   * concurrent deliveries of the same retried event would both pass a read-then-write check and
   * both apply the takeover. Here exactly one INSERT wins.
   */
  claimWebhookEvent(webhookId: string): Promise<boolean>
}

type StatsRow = {
  total_revenue: string | null
  event_count: string | null
  avg_revenue: string | null
  active_conflicts: string | null
  market_cap: string | null
  avg_control_seconds: string | null
}

export function createPostgresLedgerRepository(db: Database = getDatabase()): LedgerRepository {
  return {
    async getMarketSnapshot() {
      // One round trip for every headline figure. Each subquery is an aggregate over an indexed
      // column; splitting them into separate requests would multiply latency for no benefit.
      const { rows } = await db.query<StatsRow>(`
        SELECT
          (SELECT COALESCE(SUM(price_paid_cents), 0) FROM takeover_events)      AS total_revenue,
          (SELECT COUNT(*) FROM takeover_events)                                AS event_count,
          (SELECT COALESCE(AVG(price_paid_cents), 0) FROM takeover_events)      AS avg_revenue,
          (SELECT COUNT(*) FROM hexes WHERE is_contested)                       AS active_conflicts,
          (SELECT COALESCE(SUM(last_price_paid_cents), 0) FROM hexes)           AS market_cap,
          (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (now() - owned_since))), 0) FROM hexes) AS avg_control_seconds
      `)

      const row = rows[0]
      return {
        totalWarRevenueCents: Number(row?.total_revenue ?? 0),
        activeConflicts: Number(row?.active_conflicts ?? 0),
        globalMarketCapCents: Number(row?.market_cap ?? 0),
        totalTakeoverEvents: Number(row?.event_count ?? 0),
        avgRevenuePerTakeoverCents: Math.round(Number(row?.avg_revenue ?? 0)),
        avgControlDurationSeconds: Math.round(Number(row?.avg_control_seconds ?? 0)),
      }
    },

    async getRecentTakeovers(limit) {
      const { rows } = await db.query<{
        id: string
        hex_q: number
        hex_r: number
        attacker_empire_id: string
        defender_empire_id: string | null
        price_paid_cents: string | number
        created_at: Date | string
      }>(
        `SELECT id, hex_q, hex_r, attacker_empire_id, defender_empire_id, price_paid_cents, created_at
           FROM takeover_events
          ORDER BY created_at DESC
          LIMIT $1`,
        // Clamped: `limit` originates in a query string, and an unbounded one would let a single
        // request pull the entire ledger.
        [Math.min(Math.max(limit, 1), 100)],
      )

      return rows.map((row) => ({
        id: String(row.id),
        hexId: hexIdFor({ q: row.hex_q, r: row.hex_r }),
        attackerEmpireId: row.attacker_empire_id,
        defenderEmpireId: row.defender_empire_id,
        pricePaidCents: Number(row.price_paid_cents),
        createdAt: new Date(row.created_at).toISOString(),
      }))
    },

    async claimWebhookEvent(webhookId) {
      const { rows } = await db.query<{ webhook_id: string }>(
        `INSERT INTO processed_webhook_events (webhook_id) VALUES ($1)
         ON CONFLICT (webhook_id) DO NOTHING
         RETURNING webhook_id`,
        [webhookId],
      )
      // DO NOTHING returns no row on conflict, so an empty result means "already processed".
      return rows.length > 0
    },
  }
}

/**
 * In-memory stand-in for local dev without a database. Idempotency here is per-process and lost on
 * restart, which is exactly why it is not what production runs.
 */
export function createInMemoryLedgerRepository(): LedgerRepository {
  const seen = new Set<string>()
  return {
    async getMarketSnapshot() {
      return {
        totalWarRevenueCents: 0,
        activeConflicts: 0,
        globalMarketCapCents: 0,
        totalTakeoverEvents: 0,
        avgRevenuePerTakeoverCents: 0,
        avgControlDurationSeconds: 0,
      }
    },
    async getRecentTakeovers() {
      return []
    },
    async claimWebhookEvent(webhookId) {
      if (seen.has(webhookId)) return false
      seen.add(webhookId)
      return true
    },
  }
}
