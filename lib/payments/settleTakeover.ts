import { axialKey } from '@/lib/hex/hexMath'
import { countDisconnectedGroups } from '@/lib/hex/selectionEligibility'
import { buildOwnerLookup, verifyTakeoverStillValid, type HexFingerprint } from '@/lib/hex/takeoverGuard'
import { PROTECTION_DURATION_MS, quoteForHexes, splitEvenly } from '@/lib/pricing/takeoverPricing'
import { DEFAULT_BRAND_COLOR, normalizeBrandColor } from '@/lib/brand/dominantColor'
import { broadcaster } from '@/lib/realtime/broadcaster'
import { notifyDefenderOfTakeover } from '@/lib/notifications/retaliationNotifier'
import { logger } from '@/lib/logger'
import type { EmpireRepository } from '@/lib/repository/empireRepository'
import type { HexRepository } from '@/lib/repository/hexRepository'
import type { ResolvedBrandMetadata } from '@/lib/brand/resolveBrandMetadata'
import type { AxialCoord } from '@/lib/hex/hexMath'
import type { Empire, HexTile } from '@/types/game'

export type SettlementRequest = {
  hexIds: string[]
  targetUrl: string
  metadata: ResolvedBrandMetadata
  /** Sampled from the buyer's logo. Untrusted — normalized here before it can be stored. */
  primaryColorHex: string | undefined
  protect: boolean
  /** The state each tile was quoted at. A tile missing from this map is refused: it fails closed. */
  expected: ReadonlyMap<string, HexFingerprint>
  now?: Date
}

export type SettlementResult =
  | { applied: true; empire: Empire; hexes: HexTile[]; territoryCents: number }
  | { applied: false; reason: 'unknown_hex' | 'state_conflict'; conflicts: string[] }

/**
 * Hands paid-for territory to its buyer. The one path ownership changes through — demo claims, the
 * Dodo webhook and the Paddle webhook all call this, so none of them can drift from the others.
 *
 * Three things it gets right that the previous per-webhook code did not:
 *
 *  - **The recorded price is what was charged.** Each tile's share is an even split of the same
 *    `quoteForHexes` total checkout charged. The Paddle webhook used a superseded bulk formula that
 *    wrote a $100 four-tile purchase down as $36, deflating every figure on the site and making
 *    that territory a third as expensive to take back.
 *  - **A basket can fight inward.** Tiles in the same purchase count toward each other's
 *    reachability, exactly as checkout allowed. Without that, settlement refused the border-tile-
 *    plus-the-one-behind-it basket that checkout had just taken money for.
 *  - **The compare-and-swap happens under the row locks** (applyTakeoverBatch), and the whole
 *    purchase applies or none of it does. Checked before locking, two payments settling together
 *    both passed and the second silently took the tile from the first.
 */
export async function settleTakeover(
  repositories: { hexes: HexRepository; empires: EmpireRepository },
  request: SettlementRequest,
): Promise<SettlementResult> {
  const { hexes: hexRepository, empires: empireRepository } = repositories
  const now = request.now ?? new Date()

  const found = await hexRepository.getHexesByIds(request.hexIds)
  const missing = request.hexIds.filter((id) => !found.has(id))
  if (missing.length > 0 || request.hexIds.length === 0) {
    return { applied: false, reason: 'unknown_hex', conflicts: missing.map((id) => `Unknown hex ${id}`) }
  }
  const hexes = request.hexIds.map((id) => found.get(id) as HexTile)

  // Empires are keyed by hostname, so the buyer's identity is known before their row exists.
  const acquiringEmpireId = new URL(request.targetUrl).hostname
  const ownerAt = withBasket(
    buildOwnerLookup(await hexRepository.getNeighborOwners(hexes.map((hex) => hex.coord))),
    hexes,
    acquiringEmpireId,
  )

  // Readable, lock-free rejection first. The authoritative comparison repeats under the locks.
  const conflicts = hexes
    .map((hex) =>
      verifyTakeoverStillValid({ hex, expected: request.expected.get(hex.id), acquiringEmpireId, ownerAt, now }),
    )
    .flatMap((check) => (check.ok ? [] : [check.reason]))
  if (conflicts.length > 0) return { applied: false, reason: 'state_conflict', conflicts }

  const quote = quoteForHexes(hexes, countDisconnectedGroups(hexes.map((hex) => hex.coord)), request.protect)
  const shares = splitEvenly(quote.territoryCents, hexes.length)
  const lockedUntil = request.protect ? new Date(now.getTime() + PROTECTION_DURATION_MS).toISOString() : null

  // Must exist before any hex row can reference it. The palette default is what a FAILED logo sample
  // produces, so it is never a reason to repaint an empire that already has a colour: passed as
  // "no colour", which a new empire starts with and an existing one keeps. Sending it through
  // turned an entire territory purple whenever a later expansion could not read the logo.
  const color = normalizeBrandColor(request.primaryColorHex)
  const empire = await empireRepository.getOrCreateForUrl(
    request.targetUrl,
    request.metadata,
    color === DEFAULT_BRAND_COLOR ? undefined : color,
  )

  const result = await hexRepository.applyTakeoverBatch(
    hexes.map((hex, index) => {
      const quoted = request.expected.get(hex.id) as HexFingerprint
      return {
        hexId: hex.id,
        expected: { ownerId: quoted.ownerId, lastPricePaidCents: quoted.lastPricePaidCents },
        ownerId: empire.id,
        pricePaidCents: shares[index] as number,
        lockedUntil,
      }
    }),
    now,
  )
  if (!result.applied) return { applied: false, reason: 'state_conflict', conflicts: result.conflicts }

  await announceSettlement(result.hexes, result.previousOwners, empire, empireRepository)
  return { applied: true, empire, hexes: result.hexes, territoryCents: quote.territoryCents }
}

/** Tiles in the same purchase count as the buyer's own when judging whether a tile is reachable. */
function withBasket(
  ownerAt: (coord: AxialCoord) => string | null,
  basket: HexTile[],
  acquiringEmpireId: string,
): (coord: AxialCoord) => string | null {
  const basketKeys = new Set(basket.map((hex) => axialKey(hex.coord)))
  return (coord) => (basketKeys.has(axialKey(coord)) ? acquiringEmpireId : ownerAt(coord))
}

/**
 * Live updates and defender notifications, after the purchase is committed.
 *
 * Best-effort on purpose. A failure here must not surface as a settlement failure: the webhook
 * would answer 500, the provider would retry, and the retry would find the tiles already owned by
 * this buyer and log a spurious conflict for a payment that was in fact delivered.
 */
async function announceSettlement(
  hexes: HexTile[],
  previousOwners: Array<string | null>,
  attacker: Empire,
  empireRepository: EmpireRepository,
): Promise<void> {
  for (const [index, hex] of hexes.entries()) {
    try {
      await broadcaster.publish({ type: 'hex:updated', hex })
      const previousOwner = previousOwners[index]
      if (previousOwner && previousOwner !== attacker.id) {
        const defender = await empireRepository.getById(previousOwner)
        if (defender) await notifyDefenderOfTakeover(defender, hex, attacker)
      }
    } catch (error: unknown) {
      logger.warn('post-settlement announcement failed', {
        hexId: hex.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
