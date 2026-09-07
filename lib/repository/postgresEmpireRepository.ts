import { getDatabase, type Database } from '@/lib/db/client'
import type { EmpireRepository } from './empireRepository'
import type { Empire } from '@/types/game'
import type { ResolvedBrandMetadata } from '@/lib/brand/resolveBrandMetadata'

type EmpireRow = {
  id: string
  domain: string
  url: string
  name: string
  logo_url: string
  primary_color_hex: string
  og_title: string
  og_description: string
  capital_hex_id: string | null
  notify_webhook_url: string | null
  founded_at: Date | string
}

const EMPIRE_COLUMNS =
  'id, domain, url, name, logo_url, primary_color_hex, og_title, og_description, capital_hex_id, notify_webhook_url, founded_at'

function rowToEmpire(row: EmpireRow): Empire {
  return {
    id: row.id,
    domain: row.domain,
    url: row.url,
    name: row.name,
    logoUrl: row.logo_url,
    primaryColorHex: row.primary_color_hex,
    ogTitle: row.og_title,
    ogDescription: row.og_description,
    capitalHexId: row.capital_hex_id ?? '',
    foundedAt: new Date(row.founded_at).toISOString(),
    notifyWebhookUrl: row.notify_webhook_url,
  }
}

/**
 * Postgres-backed empire storage, keyed by hostname (ARCHITECTURE.md §6).
 *
 * The id is *derived server-side* from the submitted URL, never accepted from the client. That is
 * what makes "who is acquiring this hex" non-forgeable: an attacker can send any URL they like,
 * but the identity that results is always the hostname of that URL.
 */
export function createPostgresEmpireRepository(db: Database = getDatabase()): EmpireRepository {
  return {
    async getById(empireId) {
      const { rows } = await db.query<EmpireRow>(`SELECT ${EMPIRE_COLUMNS} FROM empires WHERE id = $1`, [
        empireId,
      ])
      return rows[0] ? rowToEmpire(rows[0]) : null
    },

    async findByUrl(url) {
      const hostname = safeHostname(url)
      if (!hostname) return null
      const { rows } = await db.query<EmpireRow>(`SELECT ${EMPIRE_COLUMNS} FROM empires WHERE id = $1`, [
        hostname,
      ])
      return rows[0] ? rowToEmpire(rows[0]) : null
    },

    async getByIds(empireIds) {
      if (empireIds.length === 0) return []
      // ANY($1) rather than a built IN-list: one bind parameter regardless of count, so the query
      // plan is cached across calls instead of recompiled for every distinct list length.
      const { rows } = await db.query<EmpireRow>(
        `SELECT ${EMPIRE_COLUMNS} FROM empires WHERE id = ANY($1)`,
        [empireIds],
      )
      return rows.map(rowToEmpire)
    },

    async getOrCreateForUrl(url, metadata) {
      const hostname = safeHostname(url)
      if (!hostname) throw new Error(`Cannot derive an empire from URL: ${url}`)

      // A single INSERT ... ON CONFLICT rather than SELECT-then-INSERT. Two payments settling for
      // the same new domain at once would both see "not found" and both insert, and one would fail
      // on the primary key; upserting makes the race a no-op instead of an error.
      //
      // Existing empires keep their branding: DO UPDATE only refreshes the scraped fields, which
      // is what a returning buyer expects when their site's metadata has changed since they first
      // claimed territory.
      const { rows } = await db.query<EmpireRow>(
        `INSERT INTO empires (id, domain, url, name, logo_url, og_title, og_description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           url = EXCLUDED.url,
           logo_url = EXCLUDED.logo_url,
           og_title = EXCLUDED.og_title,
           og_description = EXCLUDED.og_description
         RETURNING ${EMPIRE_COLUMNS}`,
        [
          hostname,
          hostname,
          url,
          hostname.split('.')[0] ?? hostname,
          metadata.logoUrl,
          metadata.title,
          metadata.description,
        ],
      )

      const row = rows[0]
      if (!row) throw new Error(`Failed to upsert empire for ${hostname}`)
      return rowToEmpire(row)
    },
  }
}

/** Hostname, or null for anything that isn't a parseable URL. Runs on untrusted input. */
function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}
