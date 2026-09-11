import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createPostgresEmpireRepository } from './postgresEmpireRepository'
import { DEFAULT_BRAND_COLOR, normalizeBrandColor } from '@/lib/brand/dominantColor'
import type { Database, SqlTransaction } from '@/lib/db/client'
import type { EmpireRepository } from './empireRepository'
import type { ResolvedBrandMetadata } from '@/lib/brand/resolveBrandMetadata'

/**
 * Covers the path that shipped the "everything is purple" bug: a colour was sampled in the browser
 * for the preview, then thrown away, so every empire was written with the hardcoded default.
 *
 * Runs against real Postgres (PGlite is Postgres compiled to WASM), which matters more than usual
 * here — the empires_color_is_hex CHECK constraint is half the contract being tested, and a mock
 * would happily accept values the real database rejects.
 */
let pglite: PGlite
let db: Database
let repository: EmpireRepository

function metadataFor(url: string): ResolvedBrandMetadata {
  const hostname = new URL(url).hostname
  return {
    title: hostname,
    description: `Territory held by ${hostname}.`,
    logoUrl: `https://${hostname}/logo.png`,
    sourceUrl: url,
  }
}

beforeAll(async () => {
  pglite = new PGlite() // in-memory: tests should not leave a database behind
  db = {
    driver: 'pglite',
    async query(text, params) {
      const result = await pglite.query(text, params as unknown[])
      return { rows: result.rows as never[] }
    },
    async exec(sql) {
      await pglite.exec(sql)
    },
    async transaction(work) {
      return pglite.transaction(async (tx) =>
        work({
          query: async (text, params) => {
            const result = await tx.query(text, params as unknown[])
            return { rows: result.rows as never[] }
          },
          exec: async (sql) => {
            await tx.exec(sql)
          },
        } as SqlTransaction),
      ) as Promise<never>
    },
    async close() {
      await pglite.close()
    },
  }

  const sql = await readFile(path.join(process.cwd(), 'db', 'migrations', '0001_init.sql'), 'utf-8')
  await pglite.exec(sql)
  repository = createPostgresEmpireRepository(db)
})

afterAll(async () => {
  await pglite.close()
})

beforeEach(async () => {
  await pglite.exec('TRUNCATE hexes, takeover_events, empires RESTART IDENTITY CASCADE')
})

describe('createPostgresEmpireRepository: brand colour persistence', () => {
  it('stores the colour sampled from the brand logo', async () => {
    const url = 'https://stripe.com'
    const empire = await repository.getOrCreateForUrl(url, metadataFor(url), '#635BFF')

    expect(empire.primaryColorHex).toBe('#635BFF')

    // Read back from the database rather than trusting the RETURNING value, since the bug was
    // about what actually landed in the row.
    const { rows } = await pglite.query<{ primary_color_hex: string }>(
      'SELECT primary_color_hex FROM empires WHERE id = $1',
      ['stripe.com'],
    )
    expect(rows[0]?.primary_color_hex).toBe('#635BFF')
  })

  it('falls back to the default when no colour could be sampled', async () => {
    // A brand whose logo is unreachable or whose scrape was blocked must still be able to buy.
    const url = 'https://blocked.example.com'
    const empire = await repository.getOrCreateForUrl(url, metadataFor(url))
    expect(empire.primaryColorHex).toBe(DEFAULT_BRAND_COLOR)
  })

  it('refreshes the colour when an existing empire claims again', async () => {
    const url = 'https://rebrand.example.com'
    await repository.getOrCreateForUrl(url, metadataFor(url), '#112233')

    // Without ON CONFLICT updating this column, an empire would be frozen at whatever colour it
    // was first created with — including the purple every existing row is stuck on.
    const updated = await repository.getOrCreateForUrl(url, metadataFor(url), '#AA55BB')
    expect(updated.primaryColorHex).toBe('#AA55BB')
  })

  it('keeps an existing empire’s colour when a later purchase could not sample one', async () => {
    // The regression: a failed sample on an expansion repainted the WHOLE territory purple.
    const url = 'https://keep-colour.example.com'
    await repository.getOrCreateForUrl(url, metadataFor(url), '#FB923C')
    const again = await repository.getOrCreateForUrl(url, metadataFor(url), undefined)
    expect(again.primaryColorHex).toBe('#FB923C')
  })

  it('keeps an existing empire’s real logo and wording when a later scrape falls back', async () => {
    const url = 'https://keep-brand.example.com'
    await repository.getOrCreateForUrl(url, metadataFor(url), '#FB923C')

    const placeholder = {
      title: 'keep-brand.example.com',
      description: 'Territory on Hex Wars, controlled by keep-brand.example.com.',
      logoUrl: 'https://www.google.com/s2/favicons?domain=keep-brand.example.com&sz=128',
      sourceUrl: url,
      isFallback: true,
    }
    const again = await repository.getOrCreateForUrl(url, placeholder, undefined)

    expect(again.logoUrl).toBe(metadataFor(url).logoUrl)
    expect(again.ogTitle).toBe(metadataFor(url).title)
    expect(again.ogDescription).toBe(metadataFor(url).description)
  })

  it('still refreshes wording when the site was genuinely re-read', async () => {
    const url = 'https://rewrite.example.com'
    await repository.getOrCreateForUrl(url, metadataFor(url))
    const again = await repository.getOrCreateForUrl(url, { ...metadataFor(url), title: 'New tagline' })
    expect(again.ogTitle).toBe('New tagline')
  })

  it('accepts every colour normalizeBrandColor can produce', async () => {
    // The two halves of the contract meeting: whatever a client sends, the value handed to the
    // database must satisfy empires_color_is_hex. Shorthand is the dangerous case — `#abc` passes
    // a naive format check but violates the constraint, turning a paid checkout into a 500.
    const hostile = ['#abc', '#000000', '#ffffff', '#fff;background:url(x)', 'red', '', undefined]

    for (const [index, value] of hostile.entries()) {
      const url = `https://h${index}.example.com`
      const empire = await repository.getOrCreateForUrl(
        url,
        metadataFor(url),
        normalizeBrandColor(value),
      )
      expect(empire.primaryColorHex).toMatch(/^#[0-9A-F]{6}$/)
    }
  })

  it('rejects a colour that bypasses normalization, proving the constraint is real', async () => {
    // Guards the guard: if this ever stops throwing, the CHECK constraint has been dropped and
    // normalizeBrandColor silently became the only thing standing between a client and the column.
    await expect(
      pglite.query(
        `INSERT INTO empires (id, domain, url, name, primary_color_hex)
         VALUES ('bad.com','bad.com','https://bad.com','Bad','#abc')`,
      ),
    ).rejects.toThrow()
  })
})
