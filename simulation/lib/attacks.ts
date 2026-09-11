import { hexIdFor } from '@/lib/hex/hexIdentity'
import { hexNeighbors, type AxialCoord } from '@/lib/hex/hexMath'
import { fingerprintHexes } from '@/lib/hex/takeoverGuard'
import { formatCents, isHexLocked, quoteForHexes } from '@/lib/pricing/takeoverPricing'
import { colorFor } from '../advertisers'
import { chooseVia } from './behaviours'
import { makeAdvertiser, type Advertiser, type ProbeOutcome, type SimContext } from './context'
import type { SimResponse } from './http'
import { errorMessage } from './logger'
import {
  buildPaymentEvent,
  deliverWebhook,
  executePurchase,
  nextRef,
  ownerOf,
  recordApplied,
  redeliver,
  type CheckoutReply,
} from './purchase'
import { createWebhookSecret } from './webhooks'
import { PLAY_RADIUS, World } from './world'

/**
 * Scams and attacks, each with the result the app MUST produce. Run one at a time with the rest of
 * the simulation paused, so before/after measurements (revenue, ownership) are exact.
 */
export type ProbeResult = { outcome: ProbeOutcome; note: string }
export type Probe = { id: string; title: string; needsWebhook: boolean; run: (ctx: SimContext) => Promise<ProbeResult> }

const stopped = (note: string): ProbeResult => ({ outcome: 'stopped', note })
const notStopped = (note: string): ProbeResult => ({ outcome: 'not-stopped', note })
const skipped = (note: string): ProbeResult => ({ outcome: 'skipped', note })
const finding = (note: string): ProbeResult => ({ outcome: 'finding', note })

/** An attacker gets a throwaway `.example` domain (which never resolves) and their own address. */
function attacker(domain: string, ip: string): Advertiser {
  return makeAdvertiser({ index: -1, url: `https://${domain}`, ip, color: colorFor(domain), budgetCents: 1_000_000_000 })
}

async function freshWorld(ctx: SimContext): Promise<World | null> {
  return (await World.load(ctx.http, ctx.observerIp)).world
}

async function openTile(ctx: SimContext): Promise<{ world: World; hexId: string } | null> {
  const world = await freshWorld(ctx)
  const spot = world?.openSpot(ctx.rng, PLAY_RADIUS)
  return world && spot ? { world, hexId: hexIdFor(spot) } : null
}

function checkout(ctx: SimContext, ip: string, body: unknown): Promise<SimResponse<CheckoutReply>> {
  return ctx.http.send<CheckoutReply>({
    method: 'POST',
    path: '/api/checkout/create-session',
    endpoint: 'POST /api/checkout/create-session',
    ip,
    body,
    timeoutMs: 90_000,
  })
}

/** A single-tile Dodo payment event for `hexId`, priced exactly as checkout would price it. */
function singleTilePayment(buyer: Advertiser, world: World, hexId: string, overrides: { paidCents?: number; currency?: string } = {}) {
  const tile = world.tile(hexId)
  const quote = quoteForHexes([tile], 1, false)
  const paymentId = nextRef('pay_sim')
  const event = buildPaymentEvent({
    paymentId,
    adv: buyer,
    hexIds: [hexId],
    protect: false,
    fingerprints: fingerprintHexes([tile]),
    quotedTotalCents: quote.totalCents,
    paidCents: overrides.paidCents ?? quote.totalCents,
    currency: overrides.currency,
  })
  return { tile, quote, paymentId, event }
}

const forgedWebhook: Probe = {
  id: 'forged-webhook',
  title: 'fake a "payment succeeded" message to get tiles for free',
  needsWebhook: true,
  async run(ctx) {
    const target = await openTile(ctx)
    if (!target) return skipped('no open tile to aim at')
    const thief = attacker('free-tiles.example', '203.0.113.10')
    const { event } = singleTilePayment(thief, target.world, target.hexId)
    const { response } = await deliverWebhook(ctx, event, { secret: createWebhookSecret() })
    const owner = await ownerOf(ctx, target.hexId)
    if (response.status === 401 && owner === null) return stopped('rejected with 401 — the signature did not match the real secret')
    return notStopped(`server answered ${response.status}; ${target.hexId} is now owned by ${owner ?? 'nobody'}`)
  },
}

const replayedWebhook: Probe = {
  id: 'replayed-webhook',
  title: 'replay a genuine payment message to get tiles (or revenue) twice',
  needsWebhook: true,
  async run(ctx) {
    const target = await openTile(ctx)
    if (!target) return skipped('no open tile to aim at')
    const buyer = attacker('replay.example', '203.0.113.11')
    const payment = singleTilePayment(buyer, target.world, target.hexId)
    const genuine = await deliverWebhook(ctx, payment.event)
    if (genuine.response.json?.applied !== true) {
      return skipped(`the genuine payment itself was not applied (${genuine.response.status} ${genuine.response.text})`)
    }
    recordApplied(ctx, {
      ref: payment.paymentId,
      via: 'webhook',
      buyer: buyer.domain,
      hexIds: [target.hexId],
      previous: [{ ownerId: payment.tile.ownerId, lastPricePaidCents: payment.tile.lastPricePaidCents }],
      territoryCents: payment.quote.territoryCents,
      paidCents: payment.quote.totalCents,
    })
    const before = (await freshWorld(ctx))?.market?.totalWarRevenueCents
    const replay = await redeliver(ctx, genuine)
    const after = (await freshWorld(ctx))?.market?.totalWarRevenueCents
    if (replay.status === 200 && replay.json?.duplicate === true && before !== undefined && before === after) {
      return stopped('the replay was recognised as a duplicate and changed nothing')
    }
    return notStopped(`replay answered ${replay.status} ${replay.text}; revenue went from ${before} to ${after}`)
  },
}

const underpayment: Probe = {
  id: 'underpayment',
  title: 'pay one cent less than the price',
  needsWebhook: true,
  async run(ctx) {
    const target = await openTile(ctx)
    if (!target) return skipped('no open tile to aim at')
    const cheapskate = attacker('underpay.example', '203.0.113.12')
    const quote = quoteForHexes([target.world.tile(target.hexId)], 1, false).totalCents
    const { event } = singleTilePayment(cheapskate, target.world, target.hexId, { paidCents: quote - 1 })
    const { response } = await deliverWebhook(ctx, event)
    const owner = await ownerOf(ctx, target.hexId)
    if (response.json?.applied === false && response.json.reason === 'amount_mismatch' && owner === null) {
      return stopped(`paying ${formatCents(quote - 1)} for a ${formatCents(quote)} tile was refused (amount_mismatch)`)
    }
    return notStopped(`server answered ${response.status} ${response.text}; tile owner is now ${owner ?? 'nobody'}`)
  },
}

const wrongCurrency: Probe = {
  id: 'wrong-currency',
  title: 'pay in a different currency than the price was quoted in',
  needsWebhook: true,
  async run(ctx) {
    const target = await openTile(ctx)
    if (!target) return skipped('no open tile to aim at')
    const buyer = attacker('currency.example', '203.0.113.13')
    const quote = quoteForHexes([target.world.tile(target.hexId)], 1, false).totalCents
    const { event } = singleTilePayment(buyer, target.world, target.hexId, { paidCents: quote * 10, currency: 'INR' })
    const { response } = await deliverWebhook(ctx, event)
    const owner = await ownerOf(ctx, target.hexId)
    if (response.json?.applied === false && response.json.reason === 'amount_mismatch' && owner === null) {
      return stopped('a payment in INR for a USD price was refused (amount_mismatch)')
    }
    return notStopped(`server answered ${response.status} ${response.text}; tile owner is now ${owner ?? 'nobody'}`)
  },
}

const stalePayment: Probe = {
  id: 'stale-payment',
  title: 'pay for a tile that someone else bought while you were still paying',
  needsWebhook: true,
  async run(ctx) {
    const rival = ctx.advertisers.find((adv) => adv.joined && !adv.blocked && adv.budgetCents - adv.spentCents > 10_000)
    const target = await openTile(ctx)
    if (!rival || !target) return skipped('needs an active advertiser and an open tile')
    const slow = attacker('slow-payer.example', '203.0.113.14')
    const payment = singleTilePayment(slow, target.world, target.hexId)
    const outcome = await executePurchase(ctx, {
      adv: rival,
      hexIds: [target.hexId],
      via: chooseVia(ctx, rival) ?? 'webhook',
      protect: false,
      category: 'ATTACK',
    })
    if (outcome !== 'applied') return skipped(`${rival.domain} did not get the tile first (${outcome})`)
    const { response } = await deliverWebhook(ctx, payment.event)
    const owner = await ownerOf(ctx, target.hexId)
    if (response.json?.applied === false && response.json.reason === 'state_conflict' && owner === rival.domain) {
      ctx.stats.paidNotDelivered += 1
      ctx.log.pay(
        'REFUND',
        slow.domain,
        `paid ${formatCents(payment.quote.totalCents)}, but ${rival.domain} bought ${target.hexId} first — nothing was delivered; in production this payment needs a refund`,
      )
      return stopped(`the late payment was refused (state_conflict) and ${rival.domain} kept the tile`)
    }
    return notStopped(`late payment answered ${response.status} ${response.text}; tile owner is now ${owner ?? 'nobody'}`)
  },
}

const chargeback: Probe = {
  id: 'chargeback',
  title: 'buy tiles, file a chargeback, then come back under another spelling of the domain',
  needsWebhook: true,
  async run(ctx) {
    const buyer =
      [...ctx.advertisers].reverse().find((adv) => !adv.joined && !adv.blocked && new URL(adv.url).pathname === '/') ??
      attacker('chargeback.example', '203.0.113.15')
    const target = await openTile(ctx)
    if (!target) return skipped('no open tile to aim at')
    const payment = singleTilePayment(buyer, target.world, target.hexId)
    const paid = await deliverWebhook(ctx, payment.event)
    if (paid.response.json?.applied !== true) return skipped(`the purchase itself failed (${paid.response.status} ${paid.response.text})`)
    recordApplied(ctx, {
      ref: payment.paymentId,
      via: 'webhook',
      buyer: buyer.domain,
      hexIds: [target.hexId],
      previous: [{ ownerId: payment.tile.ownerId, lastPricePaidCents: payment.tile.lastPricePaidCents }],
      territoryCents: payment.quote.territoryCents,
      paidCents: payment.quote.totalCents,
    })
    buyer.joined = true
    buyer.spentCents += payment.quote.totalCents
    buyer.purchases += 1
    ctx.log.pay('ATTACK', buyer.domain, `buys ${target.hexId} for ${formatCents(payment.quote.totalCents)} ... then asks their bank for the money back`)

    const dispute = await deliverWebhook(ctx, {
      business_id: 'bus_simulation',
      type: 'dispute.opened',
      timestamp: new Date().toISOString(),
      data: {
        payload_type: 'Dispute',
        dispute_id: nextRef('dsp_sim'),
        payment_id: payment.paymentId,
        amount: String(payment.quote.totalCents),
        currency: 'USD',
        dispute_status: 'dispute_opened',
        dispute_stage: 'dispute',
      },
    })
    if (dispute.response.json?.blocked !== true) {
      return notStopped(`the chargeback did not block the domain (${dispute.response.status} ${dispute.response.text})`)
    }
    buyer.blocked = true
    ctx.ledger.blocked.set(buyer.domain, ctx.log.elapsedMs())

    const comebacks = [buyer.url, `https://www.${buyer.domain}`, `https://${buyer.domain}.`, `https://${buyer.domain.toUpperCase()}`]
    const results: string[] = []
    for (const url of comebacks) {
      const spot = await openTile(ctx)
      if (!spot) break
      // A new address too — a blocked buyer switching networks must not get back in either.
      const response = await checkout(ctx, '203.0.113.16', { hexIds: [spot.hexId], url, agreedToTerms: true })
      results.push(`${url} -> ${response.status}`)
      if (response.status === 200 && response.json?.code === 'demo_applied') {
        const amount = response.json.data?.amountCents ?? 0
        recordApplied(ctx, {
          ref: nextRef('buy'),
          via: 'checkout',
          buyer: new URL(url).hostname.replace(/\.+$/, ''),
          hexIds: [spot.hexId],
          previous: null,
          territoryCents: amount,
          paidCents: amount,
        })
        ctx.log.error('ATTACK', buyer.domain, `a blocked domain bought again using ${url}`, 'E-BLOCKED-BOUGHT', { response: response.text })
      }
    }
    return results.length > 0 && results.every((line) => line.endsWith('403'))
      ? stopped(`blocked after the chargeback; every way back was refused: ${results.join(', ')}`)
      : notStopped(`not every comeback was refused: ${results.join(', ')}`)
  },
}

const disputeUnknown: Probe = {
  id: 'dispute-unknown',
  title: 'send a dispute for a payment that never happened (to get an innocent domain blocked)',
  needsWebhook: true,
  async run(ctx) {
    const { response } = await deliverWebhook(ctx, {
      business_id: 'bus_simulation',
      type: 'dispute.opened',
      timestamp: new Date().toISOString(),
      data: { payload_type: 'Dispute', payment_id: 'pay_that_never_happened' },
    })
    if (response.status === 200 && response.json?.blocked !== true) return stopped('ignored — no settled payment has that id, so nobody was blocked')
    return notStopped(`server answered ${response.status} ${response.text}`)
  },
}

const noConsent: Probe = {
  id: 'no-consent',
  title: 'check out without accepting the terms and the no-refund policy',
  needsWebhook: false,
  async run(ctx) {
    const target = await openTile(ctx)
    if (!target) return skipped('no open tile to aim at')
    const response = await checkout(ctx, '203.0.113.20', { hexIds: [target.hexId], url: 'https://no-consent.example', agreedToTerms: false })
    const owner = await ownerOf(ctx, target.hexId)
    if (response.status === 400 && owner === null) return stopped('refused with 400 — consent is required')
    return notStopped(`server answered ${response.status}; tile owner is now ${owner ?? 'nobody'}`)
  },
}

const duplicateTiles: Probe = {
  id: 'duplicate-tiles',
  title: 'put the same tile in the basket twice',
  needsWebhook: false,
  async run(ctx) {
    const target = await openTile(ctx)
    if (!target) return skipped('no open tile to aim at')
    const response = await checkout(ctx, '203.0.113.21', { hexIds: [target.hexId, target.hexId], url: 'https://twice.example', agreedToTerms: true })
    return response.status === 400 ? stopped('refused with 400') : notStopped(`server answered ${response.status} ${response.text}`)
  },
}

const internalUrls: Probe = {
  id: 'internal-urls',
  title: 'advertise an internal address (localhost, a database port, cloud metadata, a local file)',
  needsWebhook: false,
  async run(ctx) {
    const target = await openTile(ctx)
    if (!target) return skipped('no open tile to aim at')
    const urls = ['http://localhost:3000', 'http://127.0.0.1:5432', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'file:///etc/passwd']
    const results: string[] = []
    for (const url of urls) {
      const buy = await checkout(ctx, '203.0.113.22', { hexIds: [target.hexId], url, agreedToTerms: true })
      const preview = await ctx.http.send({ method: 'POST', path: '/api/brand/resolve', endpoint: 'POST /api/brand/resolve', ip: '203.0.113.22', body: { url } })
      results.push(`${url}: checkout ${buy.status}, preview ${preview.status}`)
    }
    const owner = await ownerOf(ctx, target.hexId)
    const allRefused = results.every((line) => /checkout 400, preview 400$/.test(line))
    return allRefused && owner === null ? stopped(`every internal address was refused: ${results.join('; ')}`) : notStopped(results.join('; '))
  },
}

const oversizedCheckout: Probe = {
  id: 'oversized-checkout',
  title: 'send a huge checkout request to exhaust server memory',
  needsWebhook: false,
  async run(ctx) {
    const response = await ctx.http.send({
      method: 'POST',
      path: '/api/checkout/create-session',
      endpoint: 'POST /api/checkout/create-session',
      ip: '203.0.113.23',
      rawBody: JSON.stringify({ hexIds: ['hex_0,0'], url: `https://big.example/${'a'.repeat(60_000)}`, agreedToTerms: true }),
      headers: { 'content-type': 'application/json' },
    })
    return response.status === 413 ? stopped('refused with 413 before the body was parsed') : notStopped(`server answered ${response.status}`)
  },
}

const rateLimitFlood: Probe = {
  id: 'rate-limit',
  title: 'hammer checkout from one address (probing prices, running up provider costs)',
  needsWebhook: false,
  async run(ctx) {
    const statuses: number[] = []
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await checkout(ctx, '203.0.113.99', { hexIds: ['hex_0,0'], url: 'https://flood.example', agreedToTerms: false })
      statuses.push(response.status)
    }
    const firstLimited = statuses.indexOf(429)
    if (firstLimited === -1) return notStopped(`12 requests in a row were never rate-limited: ${statuses.join(' ')}`)
    return stopped(`request ${firstLimited + 1} onwards got 429 — statuses: ${statuses.join(' ')}`)
  },
}

const ownTile: Probe = {
  id: 'own-tile',
  title: 'buy a tile you already own (to push its price up artificially)',
  needsWebhook: false,
  async run(ctx) {
    const world = await freshWorld(ctx)
    const owner = world && ctx.advertisers.find((adv) => adv.joined && !adv.blocked && world.tilesOf(adv.domain).length > 0)
    const tile = owner && world ? world.tilesOf(owner.domain)[0] : undefined
    if (!owner || !tile) return skipped('no advertiser holds a tile yet')
    const outcome = await executePurchase(ctx, { adv: owner, hexIds: [tile.id], via: 'checkout', protect: false, category: 'ATTACK', expectRefusal: true })
    return outcome === 'refused' ? stopped(`${owner.domain} could not buy their own ${tile.id}`) : notStopped(`the purchase ended as "${outcome}"`)
  },
}

const sealedTile: Probe = {
  id: 'sealed-tile',
  title: 'snipe a tile deep inside a rival\'s territory without fighting to it',
  needsWebhook: true,
  async run(ctx) {
    const world = await freshWorld(ctx)
    if (!world) return skipped('could not read the map')
    const unprotectedInterior = (map: World) => map.interiorTiles().find((hex) => !isHexLocked(hex, new Date()))
    // Needs a tile sealed in on all six sides by one owner. Long runs grow them naturally; a short
    // run may not, so the probe builds one itself — a 7-tile fortress whose centre is sealed in.
    if (!unprotectedInterior(world)) {
      const centre = world.openSpot(ctx.rng, PLAY_RADIUS)
      if (!centre) return skipped('no open ground to build a fortress on')
      const fortress = attacker('fortress.example', '203.0.113.42')
      const built = await executePurchase(ctx, {
        adv: fortress,
        hexIds: [centre, ...hexNeighbors(centre)].map(hexIdFor),
        via: 'checkout',
        protect: false,
        category: 'PROBE',
      })
      if (built !== 'applied') return skipped(`could not build a fortress to attack (${built})`)
    }
    const current = await freshWorld(ctx)
    const tile = current ? unprotectedInterior(current) : undefined
    if (!current || !tile) return skipped('no unprotected tile is fully surrounded by its owner')
    const sniper = attacker('sniper.example', '203.0.113.40')
    const viaCheckout = await executePurchase(ctx, { adv: sniper, hexIds: [tile.id], via: 'checkout', protect: false, category: 'ATTACK', expectRefusal: true })
    const payment = singleTilePayment(sniper, current, tile.id)
    const viaPayment = await deliverWebhook(ctx, payment.event)
    const owner = await ownerOf(ctx, tile.id)
    if (viaCheckout === 'refused' && viaPayment.response.json?.applied === false && owner === tile.ownerId) {
      return stopped(`${tile.id} (inside ${tile.ownerId}) was refused at checkout AND at payment settlement`)
    }
    return notStopped(`checkout: ${viaCheckout}; paid settlement: ${viaPayment.response.text}; owner now ${owner ?? 'nobody'}`)
  },
}

const protectedTile: Probe = {
  id: 'protected-tile',
  title: 'take a tile whose owner paid for protection',
  needsWebhook: false,
  async run(ctx) {
    const world = await freshWorld(ctx)
    const now = new Date()
    const tile = world?.lockedTiles(now)[0]
    if (!world || !tile) return skipped('nobody has protection running right now')
    const neighbours = new Set(hexNeighbors(tile.coord).map((coord) => world.ownerAt(coord)))
    const attackerAdv =
      ctx.advertisers.find((adv) => adv.joined && !adv.blocked && adv.domain !== tile.ownerId && neighbours.has(adv.domain)) ??
      attacker('breaker.example', '203.0.113.41')
    const outcome = await executePurchase(ctx, { adv: attackerAdv, hexIds: [tile.id], via: 'checkout', protect: false, category: 'ATTACK', expectRefusal: true })
    return outcome === 'refused'
      ? stopped(`${tile.id} stayed with ${tile.ownerId} (protected until ${tile.lockedUntil ?? '?'})`)
      : notStopped(`the purchase ended as "${outcome}"`)
  },
}

const splitPurchase: Probe = {
  id: 'split-purchase',
  title: 'buy tiles one checkout at a time to dodge the escalating price',
  needsWebhook: false,
  async run(ctx) {
    const world = await freshWorld(ctx)
    const spotA = world?.openSpot(ctx.rng, PLAY_RADIUS)
    if (!world || !spotA) return skipped('no open ground')
    const blockA = world.cluster(spotA, 3, ctx.rng)
    const takenA = new Set(blockA.map(hexIdFor))
    let blockB: AxialCoord[] = []
    for (let attempt = 0; attempt < 30 && blockB.length < 3; attempt += 1) {
      const spot = world.openSpot(ctx.rng, PLAY_RADIUS)
      const candidate = spot ? world.cluster(spot, 3, ctx.rng) : []
      const clear = candidate.every((coord) => !takenA.has(hexIdFor(coord)) && hexNeighbors(coord).every((n) => !takenA.has(hexIdFor(n))))
      if (candidate.length === 3 && clear) blockB = candidate
    }
    if (blockA.length < 3 || blockB.length < 3) return skipped('could not find two separate 3-tile blocks of open ground')

    const whole = attacker('one-basket.example', '203.0.113.50')
    const split = attacker('one-at-a-time.example', '203.0.113.51')
    await executePurchase(ctx, { adv: whole, hexIds: blockA.map(hexIdFor), via: 'checkout', protect: false, category: 'PROBE' })
    for (const coord of blockB) {
      await executePurchase(ctx, { adv: split, hexIds: [hexIdFor(coord)], via: 'checkout', protect: false, category: 'PROBE' })
    }
    const paidWhole = ctx.ledger.paidBy(whole.domain)
    const paidSplit = ctx.ledger.paidBy(split.domain)
    if (paidWhole === 0 || paidSplit === 0) return skipped('one of the purchases did not go through')
    if (paidSplit < paidWhole) {
      const saving = Math.round((1 - paidSplit / paidWhole) * 100)
      const text =
        `Three connected tiles cost ${formatCents(paidWhole)} in one checkout, but only ${formatCents(paidSplit)} when bought one checkout at a time (${saving}% less). ` +
        'The escalating price only counts tiles in the same basket, so anyone can dodge it by splitting their order. ' +
        'Possible fix: price the Nth tile a company OWNS at N x (count their existing tiles), quoted by the server.'
      ctx.stats.findings.push(text)
      return finding(text)
    }
    return stopped(`splitting saved nothing (${formatCents(paidSplit)} split vs ${formatCents(paidWhole)} in one go)`)
  },
}

const logoProxy: Probe = {
  id: 'logo-proxy',
  title: 'use the logo proxy to reach internal servers, or to serve any image under this domain',
  needsWebhook: false,
  async run(ctx) {
    const ip = '203.0.113.60'
    const logo = (url: string) =>
      ctx.http.send({ method: 'GET', path: `/api/brand/logo?url=${encodeURIComponent(url)}`, endpoint: 'GET /api/brand/logo', ip, timeoutMs: 30_000 })
    const internal = await logo('http://169.254.169.254/latest/meta-data/')
    if (internal.status === 200) return notStopped('the logo proxy fetched cloud metadata')
    const outsider = await logo('https://www.google.com/favicon.ico')
    if (outsider.status === 200) {
      const text =
        'The logo proxy (/api/brand/logo) fetched and served an image from google.com, which is not an advertiser. Anyone can make your domain serve any public image: ' +
        'free bandwidth for them, and unwanted images appearing to come from you. Internal addresses are refused. ' +
        'Possible fix: only proxy logo URLs that belong to a company on the map or to a brand preview the server just resolved.'
      ctx.stats.findings.push(text)
      return finding(text)
    }
    return stopped(`internal address refused (${internal.status}); outside image refused (${outsider.status})`)
  },
}

const webhookJunk: Probe = {
  id: 'webhook-junk',
  title: 'flood the payment webhook with an oversized body and unknown events',
  needsWebhook: true,
  async run(ctx) {
    const oversized = await ctx.http.send({
      method: 'POST',
      path: '/api/webhooks/dodo',
      endpoint: 'POST /api/webhooks/dodo',
      ip: '203.0.113.61',
      rawBody: 'x'.repeat(300_000),
      headers: { 'content-type': 'application/json' },
    })
    const unknown = await deliverWebhook(ctx, { business_id: 'bus_simulation', type: 'subscription.active', timestamp: new Date().toISOString(), data: {} })
    if (oversized.status === 413 && unknown.response.status === 200 && unknown.response.json?.ignored === 'subscription.active') {
      return stopped('oversized body refused (413); unknown event acknowledged and ignored')
    }
    return notStopped(`oversized: ${oversized.status}; unknown event: ${unknown.response.status} ${unknown.response.text}`)
  },
}

/** In the order they run; the ones needing a busy map come later, once territory exists. */
export const PROBES: readonly Probe[] = [
  forgedWebhook,
  noConsent,
  splitPurchase,
  underpayment,
  duplicateTiles,
  replayedWebhook,
  internalUrls,
  wrongCurrency,
  stalePayment,
  ownTile,
  oversizedCheckout,
  protectedTile,
  chargeback,
  rateLimitFlood,
  sealedTile,
  logoProxy,
  disputeUnknown,
  webhookJunk,
]

export async function runProbe(ctx: SimContext, probe: Probe): Promise<void> {
  ctx.log.info('ATTACK', 'attacker', `tries to ${probe.title}`)
  let result: ProbeResult
  try {
    result = await probe.run(ctx)
  } catch (error: unknown) {
    ctx.log.error('ATTACK', 'simulator', `the "${probe.id}" attack crashed inside the simulator: ${errorMessage(error)}`, 'E-SIM-BUG', {
      stack: error instanceof Error ? error.stack : undefined,
    })
    result = skipped('the attack script itself crashed')
  }
  ctx.stats.probes.push({ id: probe.id, title: probe.title, ...result })
  if (result.outcome === 'stopped') ctx.log.ok('ATTACK', 'defence', `held: ${result.note}`)
  else if (result.outcome === 'not-stopped') ctx.log.error('ATTACK', 'defence', `FAILED — ${probe.title}: ${result.note}`, 'E-ATTACK-NOT-STOPPED')
  else if (result.outcome === 'finding') ctx.log.finding('ATTACK', result.note)
  else ctx.log.info('ATTACK', 'attacker', `skipped: ${result.note}`)
}
