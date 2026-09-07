import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getRepositories } from '@/lib/repository'
import { rateLimit, clientKeyFromRequest, tooManyRequests } from '@/lib/security/rateLimit'
import { logger } from '@/lib/logger'

// Node runtime: the database drivers reached from here are Node-only.
export const runtime = 'nodejs'
// Never cached at the framework level — this is live map state, and a stale response would show a
// hex as available seconds after somebody bought it.
export const dynamic = 'force-dynamic'

/** Widest window a single request may ask for, in hex rings per axis. */
const MAX_SPAN = 400
const DEFAULT_SPAN = 40

/**
 * Coordinates are ints within the safe-integer range. Coercion rather than strict parsing because
 * these arrive as query strings, but the bounds are enforced: the map is unbounded, so the request
 * is the only thing that can bound a read, and an unvalidated span is an unbounded query.
 */
const boundsSchema = z
  .object({
    minQ: z.coerce.number().int().safe(),
    maxQ: z.coerce.number().int().safe(),
    minR: z.coerce.number().int().safe(),
    maxR: z.coerce.number().int().safe(),
  })
  .refine((b) => b.maxQ >= b.minQ && b.maxR >= b.minR, { message: 'Inverted bounds' })
  .refine((b) => b.maxQ - b.minQ <= MAX_SPAN && b.maxR - b.minR <= MAX_SPAN, {
    message: `Requested area too large (max ${MAX_SPAN} per axis)`,
  })

/**
 * The live map, for whatever window the camera is looking at.
 *
 * Returns only *sold* hexes. Unclaimed ones are derived client-side from their coordinates
 * (lib/hex/hexIdentity.ts), so an empty region costs an empty array rather than thousands of
 * identical placeholder objects — which is what lets the map be unbounded in both directions.
 */
export async function GET(request: Request): Promise<Response> {
  const limit = rateLimit(clientKeyFromRequest(request, 'map'), 120, 60_000)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds)

  const params = new URL(request.url).searchParams
  const raw = {
    minQ: params.get('minQ') ?? -DEFAULT_SPAN / 2,
    maxQ: params.get('maxQ') ?? DEFAULT_SPAN / 2,
    minR: params.get('minR') ?? -DEFAULT_SPAN / 2,
    maxR: params.get('maxR') ?? DEFAULT_SPAN / 2,
  }

  const parsed = boundsSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid bounds' },
      { status: 400 },
    )
  }

  try {
    const { hexes: hexRepo, empires: empireRepo, ledger } = await getRepositories()

    const hexes = await hexRepo.getOwnedHexesInRange(parsed.data)
    // Only the empires that actually own something in this window — not every empire in existence.
    const ownerIds = Array.from(new Set(hexes.map((hex) => hex.ownerId).filter((id): id is string => id !== null)))

    const [empires, market, recentEvents] = await Promise.all([
      empireRepo.getByIds(ownerIds),
      ledger.getMarketSnapshot(),
      ledger.getRecentTakeovers(20),
    ])

    return NextResponse.json({ success: true, data: { hexes, empires, market, recentEvents } })
  } catch (error: unknown) {
    // Detail stays server-side: a database error message can carry schema and connection details.
    logger.error('map read failed', { detail: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ success: false, error: 'Could not load the map' }, { status: 500 })
  }
}
