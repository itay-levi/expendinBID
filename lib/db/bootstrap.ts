import { getDatabase, type Database } from './client'
import { runMigrations } from './migrate'
import { buildDemoSeed } from '@/lib/demo/seedDemoState'
import { coordFromHexId } from '@/lib/hex/hexIdentity'
import { logger } from '@/lib/logger'

/**
 * Migrations and first-run seeding, run at most once per process.
 *
 * Held as a promise rather than a boolean so concurrent callers await the same work instead of
 * racing to run migrations twice — under load, several requests reach this before the first one
 * finishes, and two processes running `CREATE TABLE` simultaneously is how a boot fails.
 */
let bootstrapPromise: Promise<void> | null = null

export function ensureDatabaseReady(db: Database = getDatabase()): Promise<void> {
  bootstrapPromise ??= bootstrap(db).catch((error) => {
    // Cleared on failure so the next request retries rather than every later call inheriting a
    // rejected promise forever — a transient DB outage at boot shouldn't poison the process.
    bootstrapPromise = null
    throw error
  })
  return bootstrapPromise
}

/** Test seam: forces the next `ensureDatabaseReady` to run again. */
export function resetBootstrap(): void {
  bootstrapPromise = null
}

async function bootstrap(db: Database): Promise<void> {
  const applied = await runMigrations(db)
  if (applied.length > 0) logger.info('database migrated', { applied, driver: db.driver })
  await seedDemoDataIfEmpty(db)
}

/**
 * Seeds the fictional demo empires, but ONLY into a completely empty database.
 *
 * Guarded on emptiness rather than on an env flag because the failure mode matters: re-running
 * this against a live map would overwrite real, paid-for territory with placeholder data. An empty
 * `empires` table is the one state where that is impossible.
 */
export async function seedDemoDataIfEmpty(db: Database): Promise<boolean> {
  const { rows } = await db.query<{ count: string }>('SELECT count(*) AS count FROM empires')
  if (Number(rows[0]?.count ?? 0) > 0) return false

  const seed = buildDemoSeed()

  await db.transaction(async (tx) => {
    for (const empire of seed.empires) {
      await tx.query(
        `INSERT INTO empires (id, domain, url, name, logo_url, primary_color_hex, og_title, og_description, capital_hex_id, founded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO NOTHING`,
        [
          empire.id,
          empire.domain,
          empire.url,
          empire.name,
          empire.logoUrl,
          empire.primaryColorHex,
          empire.ogTitle,
          empire.ogDescription,
          empire.capitalHexId || null,
          empire.foundedAt,
        ],
      )
    }

    for (const hex of seed.hexes) {
      // Only sold hexes become rows — unclaimed ones are derived from their coordinates
      // (lib/hex/hexIdentity.ts), which is what keeps the map unbounded.
      if (!hex.ownerId) continue
      const coord = coordFromHexId(hex.id)
      if (!coord) continue

      await tx.query(
        `INSERT INTO hexes (q, r, owner_id, is_capital, last_price_paid_cents, is_contested, owned_since, locked_until)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (q, r) DO NOTHING`,
        [
          coord.q,
          coord.r,
          hex.ownerId,
          hex.isCapital,
          hex.lastPricePaidCents,
          hex.isContested,
          hex.ownedSince ?? new Date().toISOString(),
          hex.lockedUntil,
        ],
      )
    }
  })

  logger.info('seeded demo map into empty database', {
    empires: seed.empires.length,
    hexes: seed.hexes.filter((hex) => hex.ownerId).length,
  })
  return true
}
