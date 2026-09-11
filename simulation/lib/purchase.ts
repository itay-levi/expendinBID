import { axialKey, hexNeighbors } from '@/lib/hex/hexMath'
import { checkSelectionEligibility, countDisconnectedGroups } from '@/lib/hex/selectionEligibility'
import { fingerprintHexes, type HexFingerprint } from '@/lib/hex/takeoverGuard'
import { formatCents, isHexLocked, quoteForHexes, splitEvenly, type BasketQuote } from '@/lib/pricing/takeoverPricing'
import type { HexTile } from '@/types/game'
import type { Advertiser, SimContext } from './context'
import type { SimResponse } from './http'
import type { PreviousState } from './ledger'
import type { Details } from './logger'
import { signedHeaders } from './webhooks'
import { World } from './world'

/** Payment webhooks come from the provider's servers, never from the buyer's browser. */
export const DODO_IP = '198.51.100.10'

export type Via = 'checkout' | 'webhook'
export type PurchaseOutcome = 'applied' | 'refused' | 'race' | 'failed' | 'skipped'

export type PurchasePlan = {
  adv: Advertiser
  hexIds: string[]
  via: Via
  protect: boolean
  /** Log category: JOIN, EXPAND, SCATTER, TAKEOVER, RACE, ATTACK, PROBE. */
  category: string
  /** Tax added on top of the quote (Dodo, as Merchant of Record, can add it). Webhook purchases only. */
  taxPercent?: number
  /** Attack probes set this: the server REFUSING is the correct result. */
  expectRefusal?: boolean
}

export type CheckoutReply = {
  success?: boolean
  code?: string
  error?: string
  data?: { amountCents?: number; empireId?: string; checkoutUrl?: string }
}
export type WebhookReply = {
  received?: boolean
  applied?: boolean
  reason?: string
  duplicate?: boolean
  blocked?: boolean
  ignored?: string
  error?: string
  conflicts?: string[]
}
export type Verdict = { ok: true } | { ok: false; reason: string }

type Quoted = {
  view: World
  tiles: HexTile[]
  quote: BasketQuote
  verdict: Verdict
  previous: PreviousState[]
  fingerprints: HexFingerprint[]
  context: Details
}

type DeliveredPayment = {
  via: Via
  paidCents: number
  territoryCents: number
  /** What checkout said it charged, to compare with the price the buyer saw. Null for webhooks. */
  serverChargedCents: number | null
  trace: Details
}

let sequence = 0
export function nextRef(prefix: string): string {
  sequence += 1
  return `${prefix}_${Date.now().toString(36)}_${sequence}`
}

export function describeTiles(tiles: readonly HexTile[]): string {
  return tiles
    .map((tile) =>
      tile.ownerId ? `${tile.id} (owned by ${tile.ownerId}, last paid ${formatCents(tile.lastPricePaidCents)})` : `${tile.id} (open)`,
    )
    .join(', ')
}

/**
 * What the game rules say about this basket, given the map the buyer can see — the same eligibility
 * function the claim bar uses, plus the "already yours" and "protected" checks the server applies.
 */
export function rulesVerdict(view: World, adv: Advertiser, hexIds: readonly string[], now: Date): Verdict {
  if (new Set(hexIds).size !== hexIds.length) return { ok: false, reason: 'the same tile is in the basket twice' }
  const tiles = hexIds.map((id) => view.tile(id))
  const basket = new Set(tiles.map((tile) => axialKey(tile.coord)))
  const acting = adv.joined ? adv.domain : null
  for (const tile of tiles) {
    if (tile.ownerId === adv.domain) return { ok: false, reason: `${tile.id} is already theirs` }
    if (isHexLocked(tile, now)) return { ok: false, reason: `${tile.id} is protected` }
    const others = new Set(basket)
    others.delete(axialKey(tile.coord))
    const check = checkSelectionEligibility(tile.coord, (coord) => view.ownerAt(coord), acting, {
      selectedKeys: others,
      targetOwnerId: tile.ownerId,
    })
    if (!check.eligible) return { ok: false, reason: `${tile.id} cannot be reached from their territory` }
  }
  return { ok: true }
}

/** Whether these tiles, or anything next to them, changed between two reads of the map. */
export function stateChanged(before: World, after: World, hexIds: readonly string[]): boolean {
  for (const id of hexIds) {
    const coord = before.tile(id).coord
    for (const probe of [coord, ...hexNeighbors(coord)]) {
      const a = before.tileAt(probe)
      const b = after.tileAt(probe)
      if (a.ownerId !== b.ownerId || a.lastPricePaidCents !== b.lastPricePaidCents || a.lockedUntil !== b.lockedUntil) return true
    }
  }
  return false
}

/** One place that turns a failed HTTP call into the right log line and code. */
export function reportFailure(
  ctx: SimContext,
  category: string,
  actor: string,
  what: string,
  response: SimResponse<unknown>,
  extra: Details = {},
): void {
  if (response.status === 0) {
    ctx.log.error(category, actor, `${what} — no response (${response.networkError ?? 'unknown reason'})`, 'E-NETWORK', extra)
  } else if (response.status >= 500) {
    ctx.log.error(category, actor, `${what} — server error ${response.status}`, 'E-HTTP-5XX', { ...extra, response: response.text })
  } else if (response.status === 429) {
    ctx.log.warn(category, actor, `${what} — rate limited`, { ...extra, response: response.text }, 'E-RATE-LIMITED-USER')
  } else {
    ctx.log.error(category, actor, `${what} — unexpected HTTP ${response.status}`, 'E-UNEXPECTED-STATUS', { ...extra, response: response.text })
  }
}

/** Current owner of a tile (null = open), or undefined if the map could not be read. */
export async function ownerOf(ctx: SimContext, hexId: string): Promise<string | null | undefined> {
  const { world, response } = await World.load(ctx.http, ctx.observerIp)
  if (!world) {
    reportFailure(ctx, 'CHECK', 'observer', 'map read failed', response)
    return undefined
  }
  return world.tile(hexId).ownerId
}

/** A Dodo `payment.succeeded` event carrying exactly the metadata the app's checkout writes. */
export function buildPaymentEvent(args: {
  paymentId: string
  adv: Advertiser
  hexIds: readonly string[]
  protect: boolean
  fingerprints: readonly HexFingerprint[]
  quotedTotalCents: number
  paidCents: number
  currency?: string
}): Record<string, unknown> {
  return {
    business_id: 'bus_simulation',
    type: 'payment.succeeded',
    timestamp: new Date().toISOString(),
    data: {
      payload_type: 'Payment',
      payment_id: args.paymentId,
      status: 'succeeded',
      total_amount: args.paidCents,
      currency: args.currency ?? 'USD',
      customer: { customer_id: `cus_${args.adv.domain}`, email: `billing@${args.adv.domain}`, name: args.adv.domain },
      metadata: {
        hexIds: JSON.stringify(args.hexIds),
        targetUrl: args.adv.url,
        protect: args.protect,
        primaryColorHex: args.adv.color,
        expectedHexState: JSON.stringify(args.fingerprints),
        quotedTotalCents: args.quotedTotalCents,
        agreedToTermsAt: new Date().toISOString(),
      },
    },
  }
}

export type Delivery = { response: SimResponse<WebhookReply>; raw: string; headers: Record<string, string> }

/** Signs and posts a webhook the way Dodo would. `secret` overrides the real one (forgery tests). */
export async function deliverWebhook(
  ctx: SimContext,
  event: unknown,
  options: { secret?: string; id?: string } = {},
): Promise<Delivery> {
  const secret = options.secret ?? ctx.webhookSecret
  if (!secret) throw new Error('payment webhooks need the simulator to run its own server, which is the only way it knows the secret')
  const raw = JSON.stringify(event)
  const headers = signedHeaders(secret, options.id ?? nextRef('msg_sim'), raw)
  const response = await ctx.http.send<WebhookReply>({
    method: 'POST',
    path: '/api/webhooks/dodo',
    endpoint: 'POST /api/webhooks/dodo',
    ip: DODO_IP,
    rawBody: raw,
    headers,
    timeoutMs: 90_000,
  })
  return { response, raw, headers }
}

/** Sends the exact same bytes and headers again — a replay. */
export function redeliver(ctx: SimContext, delivery: Delivery): Promise<SimResponse<WebhookReply>> {
  return ctx.http.send<WebhookReply>({
    method: 'POST',
    path: '/api/webhooks/dodo',
    endpoint: 'POST /api/webhooks/dodo',
    ip: DODO_IP,
    rawBody: delivery.raw,
    headers: delivery.headers,
  })
}

/** Books an accepted purchase in the simulator's own ledger. Returns each tile's share. */
export function recordApplied(
  ctx: SimContext,
  args: {
    ref: string
    via: Via
    buyer: string
    hexIds: string[]
    previous: PreviousState[] | null
    territoryCents: number
    paidCents: number
  },
): number[] {
  const shares = splitEvenly(args.territoryCents, args.hexIds.length)
  ctx.ledger.record({ ...args, shares, atMs: ctx.log.elapsedMs() })
  return shares
}

/**
 * One purchase, start to finish, the way a real buyer makes it: read the map, see a price, pay —
 * through checkout or through a Dodo payment webhook — then check the map shows the result.
 *
 * Every outcome is judged against the game rules. A refusal the rules predict is fine; a refusal
 * nobody can explain, a wrong charge, or a success the map does not reflect is an error with the
 * full request, response and tile state attached.
 */
export async function executePurchase(ctx: SimContext, plan: PurchasePlan): Promise<PurchaseOutcome> {
  const { adv } = plan
  if (plan.hexIds.length === 0) return 'skipped'

  const loaded = await World.load(ctx.http, adv.ip)
  if (!loaded.world) {
    reportFailure(ctx, plan.category, adv.domain, 'could not read the map before buying', loaded.response)
    return 'failed'
  }
  const view = loaded.world
  const tiles = plan.hexIds.map((id) => view.tile(id))
  const quote = quoteForHexes(tiles, countDisconnectedGroups(tiles.map((tile) => tile.coord)), plan.protect)

  if (!plan.expectRefusal && adv.spentCents + quote.totalCents > adv.budgetCents) {
    ctx.log.info(plan.category, adv.domain, `holds back: ${formatCents(quote.totalCents)} would go over their budget of ${formatCents(adv.budgetCents)}`)
    return 'skipped'
  }

  const verdict = rulesVerdict(view, adv, plan.hexIds, new Date())
  const quoted: Quoted = {
    view,
    tiles,
    quote,
    verdict,
    previous: tiles.map((tile) => ({ ownerId: tile.ownerId, lastPricePaidCents: tile.lastPricePaidCents })),
    fingerprints: fingerprintHexes(tiles),
    context: {
      tiles: describeTiles(tiles),
      shown: `${formatCents(quote.totalCents)} = territory ${formatCents(quote.territoryCents)} + protection ${formatCents(quote.protectionCents)}`,
      rules: verdict.ok ? 'allowed' : `should be refused: ${verdict.reason}`,
    },
  }
  return plan.via === 'checkout' ? buyAtCheckout(ctx, plan, quoted) : buyWithWebhook(ctx, plan, quoted)
}

async function buyAtCheckout(ctx: SimContext, plan: PurchasePlan, quoted: Quoted): Promise<PurchaseOutcome> {
  const { adv } = plan
  adv.recentCheckouts.push(Date.now())
  const body = { hexIds: plan.hexIds, url: adv.url, protect: plan.protect, agreedToTerms: true, primaryColorHex: adv.color }
  const response = await ctx.http.send<CheckoutReply>({
    method: 'POST',
    path: '/api/checkout/create-session',
    endpoint: 'POST /api/checkout/create-session',
    ip: adv.ip,
    body,
    timeoutMs: 90_000,
  })
  const trace: Details = {
    ...quoted.context,
    request: `POST /api/checkout/create-session ${JSON.stringify(body)}`,
    response: `${response.status} ${response.text}`,
  }

  if (response.status === 200 && response.json?.code === 'demo_applied') {
    const charged = response.json.data?.amountCents
    if (typeof charged !== 'number') {
      ctx.log.error(plan.category, adv.domain, 'checkout succeeded but did not say what it charged', 'E-UNEXPECTED-STATUS', trace)
      return 'failed'
    }
    return delivered(ctx, plan, quoted, {
      via: 'checkout',
      paidCents: charged,
      territoryCents: charged - quoted.quote.protectionCents,
      serverChargedCents: charged,
      trace,
    })
  }
  if (response.status === 200 && response.json?.data?.checkoutUrl) {
    ctx.log.error(
      plan.category,
      adv.domain,
      'the server is in REAL payment mode (it returned a hosted checkout page) — the simulator cannot pay there. Run it without --attach, or attach to a server with no payment keys.',
      'E-UNEXPECTED-STATUS',
      trace,
    )
    return 'failed'
  }
  if (response.status === 409) return refused(ctx, plan, quoted, response.json?.error ?? response.text, trace, false)
  if (response.status === 403 && adv.blocked) {
    ctx.stats.refusedAsExpected += 1
    ctx.log.ok(plan.category, adv.domain, 'refused: this domain is blocked')
    return 'refused'
  }
  reportFailure(ctx, plan.category, adv.domain, 'checkout failed', response, trace)
  return 'failed'
}

async function buyWithWebhook(ctx: SimContext, plan: PurchasePlan, quoted: Quoted): Promise<PurchaseOutcome> {
  const { adv } = plan
  const paidCents = plan.taxPercent ? Math.round(quoted.quote.totalCents * (1 + plan.taxPercent / 100)) : quoted.quote.totalCents
  const paymentId = nextRef('pay_sim')
  const event = buildPaymentEvent({
    paymentId,
    adv,
    hexIds: plan.hexIds,
    protect: plan.protect,
    fingerprints: quoted.fingerprints,
    quotedTotalCents: quoted.quote.totalCents,
    paidCents,
  })
  const { response } = await deliverWebhook(ctx, event)
  const trace: Details = {
    ...quoted.context,
    payment: `${paymentId}: ${formatCents(paidCents)}${plan.taxPercent ? ` (incl. ${plan.taxPercent}% tax)` : ''}`,
    response: `${response.status} ${response.text}`,
  }
  const reply = response.json

  if (response.status === 200 && reply?.applied === true) {
    return delivered(ctx, plan, quoted, {
      via: 'webhook',
      paidCents,
      territoryCents: quoted.quote.territoryCents,
      serverChargedCents: null,
      trace,
    })
  }
  if (response.status === 200 && reply?.applied === false && reply.reason === 'state_conflict') {
    return refused(ctx, plan, quoted, (reply.conflicts ?? []).join('; ') || 'state_conflict', trace, true)
  }
  if (response.status === 200 && reply?.applied === false) {
    ctx.log.error(plan.category, adv.domain, `a full payment was refused (${reply.reason ?? 'no reason'})`, 'E-UNEXPECTED-STATUS', trace)
    return 'failed'
  }
  if (response.status === 401) {
    ctx.log.error(plan.category, adv.domain, 'a correctly signed payment webhook was rejected', 'E-WEBHOOK-REJECTED', trace)
    return 'failed'
  }
  reportFailure(ctx, plan.category, adv.domain, 'payment webhook failed', response, trace)
  return 'failed'
}

async function delivered(ctx: SimContext, plan: PurchasePlan, quoted: Quoted, payment: DeliveredPayment): Promise<PurchaseOutcome> {
  const { adv } = plan
  if (plan.expectRefusal) {
    ctx.log.error(plan.category, adv.domain, 'the server ACCEPTED a purchase it must refuse', 'E-ATTACK-NOT-STOPPED', payment.trace)
  }

  // If anything moved between what the buyer saw and what the server settled, the simulator can
  // no longer know the exact state that was bought — keep the purchase out of the exact checks.
  let certain = true
  if (payment.serverChargedCents !== null && payment.serverChargedCents !== quoted.quote.totalCents) {
    certain = false
    const again = await World.load(ctx.http, adv.ip)
    if (again.world && stateChanged(quoted.view, again.world, plan.hexIds)) {
      ctx.log.info(
        plan.category,
        adv.domain,
        `the price moved before they paid (another buyer acted): shown ${formatCents(quoted.quote.totalCents)}, charged ${formatCents(payment.serverChargedCents)}`,
      )
    } else {
      ctx.log.error(
        plan.category,
        adv.domain,
        `charged ${formatCents(payment.serverChargedCents)}, but the price shown was ${formatCents(quoted.quote.totalCents)}`,
        'E-PRICE-MISMATCH',
        payment.trace,
      )
    }
  }
  if (!quoted.verdict.ok && !plan.expectRefusal) {
    const again = await World.load(ctx.http, adv.ip)
    if (!(again.world && stateChanged(quoted.view, again.world, plan.hexIds))) {
      ctx.log.warn(plan.category, adv.domain, `the server sold a basket the rules say to refuse (${quoted.verdict.reason})`, payment.trace, 'E-RULES-DISAGREE')
    }
  }

  const shares = recordApplied(ctx, {
    ref: nextRef('buy'),
    via: payment.via,
    buyer: adv.domain,
    hexIds: plan.hexIds,
    previous: certain ? quoted.previous : null,
    territoryCents: payment.territoryCents,
    paidCents: payment.paidCents,
  })
  adv.spentCents += payment.paidCents
  adv.joined = true
  adv.purchases += 1
  const taken = quoted.tiles.filter((tile) => tile.ownerId !== null)
  adv.takeovers += taken.length

  const count = plan.hexIds.length
  const took = taken.length ? ` — took ${taken.map((tile) => `${tile.id} from ${tile.ownerId}`).join(', ')}` : ''
  ctx.log.pay(
    plan.category,
    adv.domain,
    `paid ${formatCents(payment.paidCents)} by ${payment.via === 'checkout' ? 'checkout' : 'Dodo payment'} for ${count} tile${count === 1 ? '' : 's'}${plan.protect ? ' + protection' : ''}${took}`,
  )

  await verifyOnMap(ctx, plan, shares, certain, payment.trace)
  return 'applied'
}

/** Re-reads the map, as a watching browser would on its next refresh, and checks the result. */
async function verifyOnMap(ctx: SimContext, plan: PurchasePlan, shares: number[], certain: boolean, trace: Details): Promise<void> {
  const { adv } = plan
  const after = await World.load(ctx.http, adv.ip)
  const world = after.world
  if (!world) {
    reportFailure(ctx, plan.category, adv.domain, 'could not re-read the map after buying', after.response)
    return
  }
  plan.hexIds.forEach((hexId, index) => {
    const tile = world.tile(hexId)
    if (tile.ownerId === null) {
      ctx.log.error(plan.category, adv.domain, `bought ${hexId}, but the map shows it unowned`, 'E-NOT-APPLIED', { ...trace, map: describeTiles([tile]) })
      return
    }
    if (tile.ownerId !== adv.domain) {
      if (ctx.speed.concurrency > 1) {
        ctx.log.info(plan.category, adv.domain, `${hexId} has already changed hands again, to ${tile.ownerId}`)
      } else {
        ctx.log.error(plan.category, adv.domain, `bought ${hexId}, but the map shows it owned by ${tile.ownerId}`, 'E-NOT-APPLIED', { ...trace, map: describeTiles([tile]) })
      }
      return
    }
    const share = shares[index]
    if (certain && share !== undefined && tile.lastPricePaidCents !== share) {
      ctx.log.error(
        plan.category,
        adv.domain,
        `${hexId} is recorded at ${formatCents(tile.lastPricePaidCents)}, but its share of the payment is ${formatCents(share)}`,
        'E-WRONG-PRICE-RECORDED',
        trace,
      )
    }
  })
}

async function refused(
  ctx: SimContext,
  plan: PurchasePlan,
  quoted: Quoted,
  serverReason: string,
  trace: Details,
  paid: boolean,
): Promise<PurchaseOutcome> {
  const { adv } = plan
  if (plan.expectRefusal || !quoted.verdict.ok) {
    ctx.stats.refusedAsExpected += 1
    ctx.log.ok(plan.category, adv.domain, `refused, as the rules predict — ${serverReason}`)
    if (paid && !plan.expectRefusal) noteRefund(ctx, adv, quoted, serverReason)
    return 'refused'
  }

  const again = await World.load(ctx.http, adv.ip)
  if (again.world && stateChanged(quoted.view, again.world, plan.hexIds)) {
    ctx.stats.races += 1
    ctx.log.info(plan.category, adv.domain, `lost a race — another buyer changed these tiles first (${serverReason})`)
    if (paid) noteRefund(ctx, adv, quoted, serverReason)
    return 'race'
  }

  ctx.log.error(plan.category, adv.domain, 'the server refused a purchase the game rules allow', 'E-REFUSED-VALID', { ...trace, server: serverReason })
  if (paid) noteRefund(ctx, adv, quoted, serverReason)
  return 'failed'
}

function noteRefund(ctx: SimContext, adv: Advertiser, quoted: Quoted, reason: string): void {
  ctx.stats.paidNotDelivered += 1
  ctx.log.pay(
    'REFUND',
    adv.domain,
    `paid ${formatCents(quoted.quote.totalCents)} but nothing could be delivered (${reason}) — in production this payment needs a refund from the Dodo dashboard`,
  )
}
