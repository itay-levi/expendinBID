import { getDatabase } from '@/lib/db/client'
import { ensureDatabaseReady } from '@/lib/db/bootstrap'
import { inMemoryHexRepository, type HexRepository } from './hexRepository'
import { inMemoryEmpireRepository, type EmpireRepository } from './empireRepository'
import { createPostgresHexRepository } from './postgresHexRepository'
import { createPostgresEmpireRepository } from './postgresEmpireRepository'
import {
  createInMemoryLedgerRepository,
  createPostgresLedgerRepository,
  type LedgerRepository,
} from './ledgerRepository'

export type Repositories = {
  hexes: HexRepository
  empires: EmpireRepository
  ledger: LedgerRepository
}

/**
 * Set `USE_IN_MEMORY_REPOSITORIES=1` to run with no database at all.
 *
 * This is an escape hatch for throwaway local experiments, not a supported mode: in-memory state
 * is per-process, so it silently breaks the moment there is more than one instance, and it has no
 * row locking, so concurrent takeovers race. Off by default for exactly those reasons.
 */
function useInMemory(): boolean {
  return process.env.USE_IN_MEMORY_REPOSITORIES === '1'
}

let cached: Repositories | null = null

/**
 * The application's data access, with the database guaranteed migrated and seeded first.
 *
 * Every route handler that touches persistent state must go through this rather than importing a
 * repository directly. Awaiting `ensureDatabaseReady` here is what makes "the schema exists" an
 * invariant of getting a repository at all, instead of something each route has to remember — and
 * forgetting it in one handler is the kind of omission that only shows up on a cold deploy.
 */
export async function getRepositories(): Promise<Repositories> {
  if (useInMemory()) {
    return {
      hexes: inMemoryHexRepository,
      empires: inMemoryEmpireRepository,
      ledger: createInMemoryLedgerRepository(),
    }
  }

  await ensureDatabaseReady()

  if (!cached) {
    const db = getDatabase()
    cached = {
      hexes: createPostgresHexRepository(db),
      empires: createPostgresEmpireRepository(db),
      ledger: createPostgresLedgerRepository(db),
    }
  }
  return cached
}

/** Test seam: drops cached repositories so a suite can point at a different database. */
export function resetRepositories(): void {
  cached = null
}
