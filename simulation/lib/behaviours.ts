import { hexIdFor } from '@/lib/hex/hexIdentity'
import { hexNeighbors } from '@/lib/hex/hexMath'
import { isHexLocked } from '@/lib/pricing/takeoverPricing'
import { countAction, type Advertiser, type SimContext } from './context'
import { executePurchase, reportFailure, type Via } from './purchase'
import { PLAY_RADIUS, World } from './world'

/** A person on a checkout page manages a handful a minute — and the app allows 8 per IP per minute. */
const CHECKOUTS_PER_MINUTE = 6

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** The top of the leaderboard spends the most, so earlier URLs get bigger budgets and bigger moves. */
export function tierOf(adv: Advertiser): 'big' | 'mid' | 'small' {
  if (adv.index >= 0 && adv.index < 6) return 'big'
  if (adv.index >= 0 && adv.index < 12) return 'mid'
  return 'small'
}

function checkoutsLastMinute(adv: Advertiser): number {
  const cutoff = Date.now() - 60_000
  adv.recentCheckouts = adv.recentCheckouts.filter((at) => at > cutoff)
  return adv.recentCheckouts.length
}

/**
 * How this purchase gets paid. Most go through checkout; about a third arrive as a Dodo payment
 * webhook, which is how every real payment lands in production.
 */
export function chooseVia(ctx: SimContext, adv: Advertiser): Via | null {
  const canCheckout = checkoutsLastMinute(adv) < CHECKOUTS_PER_MINUTE
  if (ctx.webhookSecret && (!canCheckout || ctx.rng.chance(0.35))) return 'webhook'
  return canCheckout ? 'checkout' : null
}

function taxFor(ctx: SimContext, via: Via): number | undefined {
  return via === 'webhook' && ctx.rng.chance(0.3) ? 8 : undefined
}

function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text
}

/** A fresh block of connected open tiles somewhere within `radius` of the centre. */
async function plantBlock(ctx: SimContext, adv: Advertiser, world: World, category: string, radius: number): Promise<void> {
  const spot = world.openSpot(ctx.rng, radius)
  if (!spot) {
    ctx.log.warn(category, adv.domain, 'found no open ground to plant a block on')
    return
  }
  const tier = tierOf(adv)
  const size = tier === 'big' ? ctx.rng.int(3, 6) : tier === 'mid' ? ctx.rng.int(2, 4) : ctx.rng.int(1, 2)
  const via = chooseVia(ctx, adv)
  if (!via) return
  await executePurchase(ctx, {
    adv,
    hexIds: world.cluster(spot, size, ctx.rng).map(hexIdFor),
    via,
    protect: ctx.rng.chance(0.1),
    category,
    taxPercent: taxFor(ctx, via),
  })
}

/** A new advertiser arrives: types their URL (the app reads their site), then claims a first block. */
export async function advertiserJoins(ctx: SimContext, adv: Advertiser): Promise<void> {
  countAction(ctx, 'join')
  adv.joinAttempts += 1
  ctx.log.info('JOIN', adv.domain, `arrives and types ${adv.url} into the claim bar`)

  const brand = await ctx.http.send<{ success?: boolean; error?: string; data?: { title?: string } }>({
    method: 'POST',
    path: '/api/brand/resolve',
    endpoint: 'POST /api/brand/resolve',
    ip: adv.ip,
    body: { url: adv.url },
    timeoutMs: 30_000,
  })
  if (brand.status === 200 && brand.json?.success) {
    ctx.log.info('JOIN', adv.domain, `their site was read: "${shorten(brand.json.data?.title ?? '(no title)', 70)}"`)
  } else if (brand.status === 422 || brand.status === 400) {
    ctx.log.warn('JOIN', adv.domain, `their site could not be read (${brand.json?.error ?? `HTTP ${brand.status}`}) — the map will show a hostname placeholder`)
  } else {
    reportFailure(ctx, 'JOIN', adv.domain, 'brand preview failed', brand)
  }

  const { world, response } = await World.load(ctx.http, adv.ip)
  if (!world) {
    reportFailure(ctx, 'JOIN', adv.domain, 'could not read the map', response)
    return
  }
  const joined = ctx.advertisers.filter((other) => other.joined).length
  // Newcomers settle near the middle first, then further out as the centre fills up.
  await plantBlock(ctx, adv, world, 'JOIN', 6 + Math.floor(joined / 2))
}

/** Grows existing territory — or, now and then, opens a second billboard elsewhere (the spread premium). */
export async function advertiserExpands(ctx: SimContext, adv: Advertiser): Promise<void> {
  countAction(ctx, 'expand')
  const { world, response } = await World.load(ctx.http, adv.ip)
  if (!world) {
    reportFailure(ctx, 'EXPAND', adv.domain, 'could not read the map', response)
    return
  }
  if (world.tilesOf(adv.domain).length === 0) {
    ctx.log.info('EXPAND', adv.domain, 'has lost every tile — plants a new block')
    await plantBlock(ctx, adv, world, 'EXPAND', PLAY_RADIUS)
    return
  }
  if (ctx.rng.chance(0.15)) {
    ctx.log.info('SCATTER', adv.domain, 'opens a second billboard somewhere else on the map')
    await plantBlock(ctx, adv, world, 'SCATTER', PLAY_RADIUS)
    return
  }
  const frontier = world.frontierOf(adv.domain)
  if (frontier.length === 0) {
    ctx.log.info('EXPAND', adv.domain, 'is boxed in — no open ground touches their territory')
    return
  }
  const size = tierOf(adv) === 'big' ? ctx.rng.int(2, 4) : ctx.rng.int(1, 3)
  const via = chooseVia(ctx, adv)
  if (!via) return
  await executePurchase(ctx, {
    adv,
    hexIds: world.cluster(ctx.rng.pick(frontier), size, ctx.rng).map(hexIdFor),
    via,
    protect: ctx.rng.chance(0.08),
    category: 'EXPAND',
    taxPercent: taxFor(ctx, via),
  })
}

/** Takes one or two rival tiles on their border — what the red attack arrows invite. */
export async function advertiserAttacks(ctx: SimContext, adv: Advertiser): Promise<void> {
  countAction(ctx, 'takeover')
  const { world, response } = await World.load(ctx.http, adv.ip)
  if (!world) {
    reportFailure(ctx, 'TAKEOVER', adv.domain, 'could not read the map', response)
    return
  }
  const now = new Date()
  const targets = world.rivalBorderOf(adv.domain, now)
  if (targets.length === 0) {
    ctx.log.info('TAKEOVER', adv.domain, 'has no unprotected rival on their border to attack')
    return
  }
  const first = ctx.rng.pick(targets)
  const basket = [first.id]
  if (tierOf(adv) !== 'small' && ctx.rng.chance(0.4)) {
    const second = hexNeighbors(first.coord)
      .map((coord) => world.tileAt(coord))
      .find((tile) => tile.ownerId !== null && tile.ownerId !== adv.domain && !isHexLocked(tile, now))
    if (second) basket.push(second.id)
  }
  const via = chooseVia(ctx, adv)
  if (!via) return
  ctx.log.info('TAKEOVER', adv.domain, `attacks ${first.ownerId ?? 'a rival'} and goes for ${basket.join(', ')}`)
  await executePurchase(ctx, {
    adv,
    hexIds: basket,
    via,
    protect: ctx.rng.chance(0.12),
    category: 'TAKEOVER',
    taxPercent: taxFor(ctx, via),
  })
}

/** Two buyers click the same open tile at the same moment. Exactly one may win. */
export async function raceForTile(ctx: SimContext, first: Advertiser, second: Advertiser): Promise<void> {
  countAction(ctx, 'race')
  const { world, response } = await World.load(ctx.http, ctx.observerIp)
  if (!world) {
    reportFailure(ctx, 'RACE', 'observer', 'could not read the map', response)
    return
  }
  const spot = world.openSpot(ctx.rng, PLAY_RADIUS)
  const viaFirst = chooseVia(ctx, first)
  const viaSecond = chooseVia(ctx, second)
  if (!spot || !viaFirst || !viaSecond) return

  const hexId = hexIdFor(spot)
  const label = `${first.domain} vs ${second.domain}`
  ctx.log.info('RACE', label, `both go for ${hexId} at the same moment`)
  const results = await Promise.all([
    executePurchase(ctx, { adv: first, hexIds: [hexId], via: viaFirst, protect: false, category: 'RACE' }),
    executePurchase(ctx, { adv: second, hexIds: [hexId], via: viaSecond, protect: false, category: 'RACE' }),
  ])
  const winners = results.filter((result) => result === 'applied').length
  if (winners > 1) {
    ctx.log.error('RACE', label, `BOTH buyers were given ${hexId}`, 'E-DOUBLE-SALE', { results: results.join(' / ') })
  } else if (winners === 1) {
    ctx.log.ok('RACE', label, `exactly one buyer won ${hexId}; the other was turned away`)
  } else {
    ctx.log.info('RACE', label, `neither buyer got ${hexId} (${results.join(' / ')})`)
  }
}

/** Sleeps in small steps so a visitor notices the end of the run promptly. */
async function sleepUnlessStopped(ms: number, isStopped: () => boolean): Promise<void> {
  const until = Date.now() + ms
  while (!isStopped() && Date.now() < until) await sleep(Math.min(250, until - Date.now()))
}

/**
 * Someone with the site open in a tab: loads the page once, then re-reads the map on the same
 * 8-second cycle as the real UI, and now and then loads an advertiser's logo.
 */
export async function visitorSession(ctx: SimContext, index: number, isStopped: () => boolean): Promise<void> {
  const ip = `10.30.${Math.floor(index / 250)}.${(index % 250) + 1}`
  const name = `visitor-${index + 1}`
  ctx.stats.visitorsOnline += 1
  ctx.stats.visitorsPeak = Math.max(ctx.stats.visitorsPeak, ctx.stats.visitorsOnline)
  ctx.log.info('VISIT', name, 'opens the site')
  try {
    const page = await ctx.http.send({ method: 'GET', path: '/', endpoint: 'GET / (page)', ip, timeoutMs: 120_000 })
    if (page.status !== 200) reportFailure(ctx, 'VISIT', name, 'the home page did not load', page)

    while (!isStopped()) {
      if (!ctx.paused) {
        const { world, response } = await World.load(ctx.http, ip)
        if (!world) {
          reportFailure(ctx, 'VISIT', name, 'map refresh failed', response)
        } else if (ctx.rng.chance(0.15)) {
          const withLogos = [...world.empires.values()].filter((empire) => /^https?:\/\//.test(empire.logoUrl))
          if (withLogos.length > 0) {
            const empire = ctx.rng.pick(withLogos)
            const logo = await ctx.http.send({
              method: 'GET',
              path: `/api/brand/logo?url=${encodeURIComponent(empire.logoUrl)}`,
              endpoint: 'GET /api/brand/logo',
              ip,
              timeoutMs: 30_000,
            })
            // A site that refuses to serve its logo is normal (422); only a server fault is a problem.
            if (logo.status === 0 || logo.status >= 500) reportFailure(ctx, 'VISIT', name, `the logo for ${empire.domain} failed`, logo)
          }
        }
      }
      const jitter = 0.8 + ctx.rng.next() * 0.4
      await sleepUnlessStopped(ctx.speed.visitorPollMs * jitter, isStopped)
    }
  } finally {
    ctx.stats.visitorsOnline -= 1
  }
}
