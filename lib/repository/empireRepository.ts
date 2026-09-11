import type { Empire } from '@/types/game'
import type { ResolvedBrandMetadata } from '@/lib/brand/resolveBrandMetadata'
import { DEFAULT_BRAND_COLOR } from '@/lib/brand/dominantColor'
import { buildDemoSeed } from '@/lib/demo/seedDemoState'

// Same Repository-pattern placeholder as hexRepository.ts — in-memory here, a real
// Postgres-backed implementation (keyed by domain, per ARCHITECTURE.md §6) in production.
export type EmpireRepository = {
  getById(empireId: string): Promise<Empire | null>
  /** Read-only — does NOT create an empire. Used to check "does this URL already control
   *  territory" before payment, without prematurely creating a record for an unpaid attempt. */
  findByUrl(url: string): Promise<Empire | null>
  getOrCreateForUrl(
    url: string,
    metadata: ResolvedBrandMetadata,
    /** Sampled from the logo. Omitted falls back to the palette default. */
    primaryColorHex?: string,
  ): Promise<Empire>
  /** Batched read for a map response — one query for a whole page of hexes, not one per owner. */
  getByIds(empireIds: string[]): Promise<Empire[]>
}

// Keyed by hostname (also used as the empire id), seeded with the same demo empires the client
// renders so adjacency checks server-side see the same territory the player sees.
const memoryStore = new Map<string, Empire>(buildDemoSeed().empires.map((e) => [e.id, e]))

export const inMemoryEmpireRepository: EmpireRepository = {
  async getById(empireId) {
    return memoryStore.get(empireId) ?? null
  },
  async findByUrl(url) {
    return memoryStore.get(new URL(url).hostname) ?? null
  },
  async getOrCreateForUrl(url, metadata, primaryColorHex) {
    const hostname = new URL(url).hostname
    const existing = memoryStore.get(hostname)
    if (existing) return existing

    const empire: Empire = {
      id: hostname,
      domain: hostname,
      url,
      name: hostname.split('.')[0] ?? hostname,
      logoUrl: metadata.logoUrl,
      primaryColorHex: primaryColorHex ?? DEFAULT_BRAND_COLOR,
      ogTitle: metadata.title,
      ogDescription: metadata.description,
      capitalHexId: '',
      foundedAt: new Date().toISOString(),
      notifyWebhookUrl: null,
    }
    memoryStore.set(hostname, empire)
    return empire
  },
  async getByIds(empireIds) {
    return empireIds
      .map((id) => memoryStore.get(id))
      .filter((empire): empire is Empire => empire !== undefined)
  },
}

export const empireRepository: EmpireRepository = inMemoryEmpireRepository
