import { logger } from '@/lib/logger'

/**
 * The minimum surface both drivers share. Repositories are written against this, so the same SQL
 * runs in dev and in production without a dialect-translation layer.
 */
export type SqlClient = {
  query<Row = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: Row[] }>
  /**
   * Runs a multi-statement script (a migration file) with no parameters.
   *
   * Separate from `query` because parameterised queries use Postgres' extended protocol, which
   * accepts exactly one statement — passing a whole migration file to it fails with "cannot insert
   * multiple commands into a prepared statement". This uses the simple protocol instead. It takes
   * no parameters by design: never build a statement for this from untrusted input.
   */
  exec(sql: string): Promise<void>
}

export type SqlTransaction = SqlClient

export type Database = SqlClient & {
  /**
   * Runs `work` inside a transaction, committing on success and rolling back on any throw.
   *
   * Takeovers MUST go through this. The concurrency correctness of the whole product is one
   * `SELECT ... FOR UPDATE` inside a transaction (ARCHITECTURE.md §8): two attackers hitting the
   * same hex in the same millisecond serialize on that lock, and the loser re-reads the price the
   * winner just wrote. Doing the same check outside a transaction — read, compare, write — is a
   * lost update, and the symptom is a hex sold twice at the same price.
   */
  transaction<T>(work: (tx: SqlTransaction) => Promise<T>): Promise<T>
  close(): Promise<void>
  /** Which driver is live. Surfaced so startup logs and health checks can say so out loud. */
  readonly driver: 'postgres' | 'pglite'
}

let instance: Database | null = null

/**
 * The process-wide database handle.
 *
 * Postgres when `DATABASE_URL` is set, PGlite otherwise. PGlite is not a Postgres *emulation* —
 * it is Postgres itself compiled to WebAssembly, so dev runs the same engine, the same migration
 * file, the same `FOR UPDATE` semantics and the same SQL as production. That matters here more
 * than convenience: row-level locking is the one behaviour this app cannot afford to discover is
 * different in production, and a SQLite-shaped dev database would not exercise it at all.
 */
export function getDatabase(): Database {
  if (instance) return instance
  const connectionString = process.env.DATABASE_URL
  instance = connectionString ? createPostgres(connectionString) : createPglite()
  return instance
}

/** Test seam: drops the cached handle so a suite can point at a fresh database. */
export async function resetDatabase(): Promise<void> {
  if (instance) await instance.close()
  instance = null
}

function createPostgres(connectionString: string): Database {
  // Required lazily so the `pg` driver is never pulled into a bundle that only uses PGlite.
  const { Pool } = require('pg') as typeof import('pg')

  const pool = new Pool({
    connectionString,
    // Sized for a serverless/multi-instance deployment, where the total connection count is
    // (instances x max) and Postgres' own limit is the real ceiling. Raising this per instance is
    // usually the wrong lever — a pooler like PgBouncer in front is the right one.
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    // Fail fast rather than queueing forever behind an exhausted pool: a request that waits
    // indefinitely for a connection holds its own resources while it does.
    connectionTimeoutMillis: 5_000,
  })

  // An idle-client error (a dropped connection, a failover) is emitted on the pool, and an
  // unhandled 'error' event on an EventEmitter takes the process down.
  pool.on('error', (error: Error) => {
    logger.error('postgres pool error on idle client', { message: error.message })
  })

  return {
    driver: 'postgres',
    async query(text, params) {
      const result = await pool.query(text, params as unknown[])
      return { rows: result.rows as never[] }
    },
    async exec(sql) {
      await pool.query(sql)
    },
    async transaction(work) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await work({
          query: async (text, params) => {
            const queryResult = await client.query(text, params as unknown[])
            return { rows: queryResult.rows as never[] }
          },
          exec: async (sql) => {
            await client.query(sql)
          },
        })
        await client.query('COMMIT')
        return result
      } catch (error) {
        // Best-effort: if the connection itself died, ROLLBACK also fails, and the original error
        // is the one worth propagating.
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },
    async close() {
      await pool.end()
    },
  }
}

function createPglite(): Database {
  const { PGlite } = require('@electric-sql/pglite') as typeof import('@electric-sql/pglite')

  // A directory, not in-memory, so dev data survives a restart the way a real database does.
  const db = new PGlite(process.env.PGLITE_PATH ?? '.pglite')

  logger.info('using PGlite (no DATABASE_URL set) — real Postgres, local file', {
    path: process.env.PGLITE_PATH ?? '.pglite',
  })

  return {
    driver: 'pglite',
    async query(text, params) {
      const result = await db.query(text, params as unknown[])
      return { rows: result.rows as never[] }
    },
    async exec(sql) {
      await db.exec(sql)
    },
    async transaction(work) {
      // PGlite is single-connection, so its `transaction` helper is the only correct way to get
      // BEGIN/COMMIT here — issuing them as bare queries would interleave with concurrent callers.
      return db.transaction(async (tx) => {
        return work({
          query: async (text, params) => {
            const result = await tx.query(text, params as unknown[])
            return { rows: result.rows as never[] }
          },
          exec: async (sql) => {
            await tx.exec(sql)
          },
        })
      }) as Promise<never>
    },
    async close() {
      await db.close()
    },
  }
}
