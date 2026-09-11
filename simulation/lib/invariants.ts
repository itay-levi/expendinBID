import { formatCents } from '@/lib/pricing/takeoverPricing'
import type { SimContext } from './context'
import type { AppliedPurchase } from './ledger'
import { reportFailure } from './purchase'
import { World } from './world'

export type CheckResult = { name: string; passed: boolean; detail: string }

const blockKey = (domain: string): string => domain.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '')

/** Tiles owned by a company the map has no record of. Safe to run while the simulation is busy. */
export function checkOrphans(ctx: SimContext, world: World): string[] {
  const missing = new Set<string>()
  for (const hex of world.hexes.values()) {
    if (hex.ownerId && !world.empires.has(hex.ownerId)) missing.add(hex.ownerId)
  }
  for (const owner of missing) {
    ctx.log.error('CHECK', 'invariant', `tiles are owned by "${owner}", but the map has no company record for it`, 'E-ORPHAN-OWNER')
  }
  return [...missing]
}

/**
 * The same tile bought twice starting from the same state means two payments both passed the
 * compare-and-swap. Prices only ever rise on a takeover, so a state can legitimately occur once.
 */
function findDoubleSales(applied: readonly AppliedPurchase[]): string[] {
  const seen = new Map<string, AppliedPurchase>()
  const problems: string[] = []
  for (const purchase of applied) {
    if (!purchase.previous) continue
    purchase.hexIds.forEach((hexId, index) => {
      const previous = purchase.previous?.[index]
      if (!previous) return
      const key = `${hexId}|${previous.ownerId ?? 'open'}|${previous.lastPricePaidCents}`
      const earlier = seen.get(key)
      if (earlier) {
        problems.push(
          `${hexId} was sold to ${earlier.buyer} (${earlier.ref}) AND to ${purchase.buyer} (${purchase.ref}), both from the same state (${previous.ownerId ?? 'open'} at ${formatCents(previous.lastPricePaidCents)})`,
        )
      } else {
        seen.set(key, purchase)
      }
    })
  }
  return problems
}

/**
 * Replays every accepted purchase of each tile as a chain — each purchase starts from the state
 * the previous one left — and compares the end of the chain with what the map shows.
 */
function findStateDrift(applied: readonly AppliedPurchase[], world: World): string[] {
  type Step = { buyer: string; share: number; from: string }
  const chains = new Map<string, Step[]>()
  const uncertain = new Set<string>()
  for (const purchase of applied) {
    purchase.hexIds.forEach((hexId, index) => {
      const previous = purchase.previous?.[index]
      const share = purchase.shares[index]
      if (!previous || share === undefined) {
        uncertain.add(hexId)
        return
      }
      const steps = chains.get(hexId) ?? []
      steps.push({ buyer: purchase.buyer, share, from: `${previous.ownerId ?? 'open'}|${previous.lastPricePaidCents}` })
      chains.set(hexId, steps)
    })
  }

  const problems: string[] = []
  for (const [hexId, steps] of chains) {
    if (uncertain.has(hexId)) continue
    const consumed = new Set(steps.map((step) => step.from))
    const ends = steps.filter((step) => !consumed.has(`${step.buyer}|${step.share}`))
    if (ends.length !== 1) continue // a broken chain is a double sale, reported on its own
    const last = ends[0]
    if (!last) continue
    const tile = world.tile(hexId)
    if (tile.ownerId !== last.buyer || tile.lastPricePaidCents !== last.share) {
      problems.push(
        `${hexId}: the payments end with ${last.buyer} at ${formatCents(last.share)}, but the map shows ${tile.ownerId ?? 'nobody'} at ${formatCents(tile.lastPricePaidCents)}`,
      )
    }
  }
  return problems
}

/** Everything that must add up once the simulation has gone quiet. */
export async function finalChecks(ctx: SimContext): Promise<{ checks: CheckResult[]; world: World | null }> {
  const { world, response } = await World.load(ctx.http, ctx.observerIp)
  if (!world) {
    reportFailure(ctx, 'CHECK', 'observer', 'the final map read failed', response)
    return { checks: [{ name: 'The final map could be read', passed: false, detail: `HTTP ${response.status}` }], world: null }
  }
  const checks: CheckResult[] = []

  const orphans = checkOrphans(ctx, world)
  checks.push({
    name: 'Every owned tile belongs to a known company',
    passed: orphans.length === 0,
    detail: orphans.length ? orphans.join(', ') : `${world.hexes.size} tiles checked`,
  })

  const doubles = findDoubleSales(ctx.ledger.applied)
  for (const problem of doubles) ctx.log.error('CHECK', 'invariant', problem, 'E-DOUBLE-SALE')
  checks.push({
    name: 'No tile was ever sold twice from the same state',
    passed: doubles.length === 0,
    detail: doubles.length ? `${doubles.length} double sale(s)` : `${ctx.ledger.applied.length} purchases checked`,
  })

  const drift = findStateDrift(ctx.ledger.applied, world)
  for (const problem of drift) ctx.log.error('CHECK', 'invariant', problem, 'E-STATE-DRIFT')
  checks.push({
    name: 'Final owners and recorded prices match the payments',
    passed: drift.length === 0,
    detail: drift.length ? `${drift.length} tile(s) differ` : 'every tile matches its payment history',
  })

  const recorded = (world.market?.totalWarRevenueCents ?? 0) - ctx.baselineRevenueCents
  const paid = ctx.ledger.revenueCents()
  if (recorded !== paid) {
    ctx.log.error('CHECK', 'invariant', `the map reports ${formatCents(recorded)} of new revenue, but ${formatCents(paid)} was paid for territory`, 'E-REVENUE-DRIFT', {
      difference: formatCents(recorded - paid),
    })
  }
  checks.push({
    name: 'Revenue shown on the map equals what was paid for territory',
    passed: recorded === paid,
    detail: `${formatCents(recorded)} recorded vs ${formatCents(paid)} paid`,
  })

  const offenders = ctx.ledger.applied.filter((purchase) => {
    const blockedAt = ctx.ledger.blocked.get(blockKey(purchase.buyer))
    return blockedAt !== undefined && purchase.atMs > blockedAt
  })
  checks.push({
    name: 'Domains blocked for a chargeback never bought again',
    passed: offenders.length === 0,
    detail: offenders.length ? offenders.map((purchase) => purchase.buyer).join(', ') : `${ctx.ledger.blocked.size} domain(s) blocked`,
  })

  const crashes = ctx.log.codes.get('E-SERVER-CRASH') ?? 0
  const serverErrors = ctx.metrics.total5xx()
  checks.push({
    name: 'No server crashes or 5xx responses',
    passed: crashes === 0 && serverErrors === 0,
    detail: `${serverErrors} 5xx response(s), ${crashes} crash line(s) in the server log, ${ctx.metrics.totalNetworkErrors()} request(s) with no answer`,
  })

  const worked = ctx.stats.probes.filter((probe) => probe.outcome === 'not-stopped')
  checks.push({
    name: 'Every attack and scam attempt was stopped',
    passed: worked.length === 0,
    detail: worked.length ? worked.map((probe) => probe.id).join(', ') : `${ctx.stats.probes.length} attempted`,
  })

  const slow: string[] = []
  const map = ctx.metrics.row('GET /api/map')
  const buy = ctx.metrics.row('POST /api/checkout/create-session')
  if (map && map.p95 > 1_000) slow.push(`map reads p95 ${Math.round(map.p95)}ms`)
  if (buy && buy.p95 > 8_000) slow.push(`checkout p95 ${Math.round(buy.p95)}ms`)
  for (const line of slow) ctx.log.warn('CHECK', 'performance', line, {}, 'E-SLOW')
  checks.push({
    name: 'Response times are acceptable (map p95 < 1s, checkout p95 < 8s)',
    passed: slow.length === 0,
    detail: slow.join('; ') || 'within limits',
  })

  return { checks, world }
}
