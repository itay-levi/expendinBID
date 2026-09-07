import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { getDatabase, type Database } from './client'
import { logger } from '@/lib/logger'

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations')

/**
 * Applies any migration files that haven't run yet, in filename order.
 *
 * Deliberately minimal — a ledger table and a directory listing. What it does guarantee is the
 * part that matters: each file runs exactly once, inside a transaction, and a failure rolls the
 * whole file back rather than leaving the schema half-applied. Swap in a dedicated tool
 * (node-pg-migrate, Flyway) when migrations start needing branching or down-steps.
 */
export async function runMigrations(db: Database = getDatabase()): Promise<string[]> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT        PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  const applied = new Set(
    (await db.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map(
      (row) => row.filename,
    ),
  )

  const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort()
  const ran: string[] = []

  for (const filename of files) {
    if (applied.has(filename)) continue

    const sql = await readFile(path.join(MIGRATIONS_DIR, filename), 'utf-8')
    await db.transaction(async (tx) => {
      await tx.exec(sql)
      // Recorded in the SAME transaction as the DDL. Recording it separately leaves a window where
      // the schema changed but the ledger didn't, and the next boot re-runs the file.
      await tx.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename])
    })

    ran.push(filename)
    logger.info('applied migration', { filename })
  }

  return ran
}
