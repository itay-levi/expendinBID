import { NextResponse } from 'next/server'
import { z } from 'zod'
import { parseTargetUrl } from '@/lib/validation/targetUrlSchema'
import { resolveBrandMetadata } from '@/lib/brand/resolveBrandMetadata'
import { hexIdFor } from '@/lib/hex/hexIdentity'
import {
  PENDING_SELECTION_EMPIRE_ID,
  checkSelectionEligibility,
  countDisconnectedGroups,
} from '@/lib/hex/selectionEligibility'
import { getRepositories } from '@/lib/repository'
import {
  requiredPriceForHex,
  priceForSelection,
  PROTECTION_FEE_CENTS,
  PROTECTION_DURATION_MS,
  assertTakeoverAllowed,
} from '@/lib/pricing/takeoverPricing'
import { ELIGIBILITY_MESSAGES } from '@/lib/hex/territoryEligibility'
import { fingerprintHexes } from '@/lib/hex/takeoverGuard'
import { axialKey } from '@/lib/hex/hexMath'
import { createPaddleTransaction, readPaddleConfig } from '@/lib/payments/paddleClient'
import { logger } from '@/lib/logger'
import { rateLimit, clientKeyFromRequest, tooManyRequests } from '@/lib/security/rateLimit'

// Computes the charge server-side from the current, authoritative hex state — the client sends
// only *which* hexes and *whether* to add protection; it never sends an amount. This is the same
// principle as the rest of the pricing system (ARCHITECTURE.md §8/§12): a client-submitted price
// is a UI preview, never payment authorization.
const requestSchema = z.object({
  // Generous but bounded: a claim of any shape is allowed, but one request may not ask the
  // server to price and write an unbounded number of tiles.
  hexIds: z.array(z.string()).min(1).max(200),
  url: z.string(),
  protect: z.boolean().optional().default(false),
  // Must be checked, not just present-and-truthy-ish — a missing or false value is rejected below
  // with its own message rather than falling through to the generic "Invalid request body" error,
  // since this is a distinct, user-actionable condition (go back and check the box), not malformed input.
  agreedToTerms: z.boolean(),
})

// Node runtime: the SSRF guard reached from here uses node:dns/node:net.
export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  // Each call creates a payment-provider session and triggers an outbound scrape, so it is both
  // costly and abusable. Also stops rapid-fire probing of hex prices/eligibility across the map.
  const limit = rateLimit(clientKeyFromRequest(request, 'checkout'), 8, 60_000)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds)

  const { hexes: hexRepository, empires: empireRepository } = await getRepositories()

  const json = await request.json().catch(() => null)
  const parsedBody = requestSchema.safeParse(json)
  if (!parsedBody.success) {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 })
  }

  if (!parsedBody.data.agreedToTerms) {
    return NextResponse.json(
      { success: false, error: 'You must accept the Terms of Service and No-Refund Policy to continue' },
      { status: 400 },
    )
  }

  const parsedUrl = parseTargetUrl(parsedBody.data.url)
  if (!parsedUrl.success) {
    return NextResponse.json({ success: false, error: parsedUrl.error }, { status: 400 })
  }

  const hexes = await Promise.all(parsedBody.data.hexIds.map((id) => hexRepository.getHexById(id)))
  const missing = hexes.findIndex((h) => h === null)
  if (missing !== -1) {
    return NextResponse.json({ success: false, error: `Unknown hex: ${parsedBody.data.hexIds[missing]}` }, { status: 404 })
  }
  const foundHexes = hexes.filter((h): h is NonNullable<typeof h> => h !== null)

  try {
    foundHexes.forEach((hex) => assertTakeoverAllowed(hex))
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Hex unavailable' }, { status: 409 })
  }

  // Territorial adjacency rule (ARCHITECTURE.md §23): a hex can only be acquired if it borders
  // territory the acquiring empire already controls, or sits in genuinely unclaimed space. This
  // is the check that actually matters — the client's own hover/click gating is a UX convenience,
  // not a security boundary; a direct API call has to be stopped here.
  const acquiringEmpire = await empireRepository.findByUrl(parsedUrl.url)

  // Only the neighbours of the requested hexes are fetched, never the whole map. The map is
  // unbounded, so a full read is a query whose cost grows with total sales — at this endpoint's
  // traffic that is the difference between a bounded index lookup and a scan of every hex ever
  // sold. See lib/repository/hexRepository.ts.
  const neighborOwners = await hexRepository.getNeighborOwners(foundHexes.map((hex) => hex.coord))
  // Hexes in the same basket count toward each other's reachability: buying a border tile and the
  // one behind it in one transaction is how a buyer fights inward. Mirrors the client preview in
  // lib/hex/selectionEligibility.ts.
  const basketOwner = acquiringEmpire?.id ?? PENDING_SELECTION_EMPIRE_ID
  const basketKeys = new Set(foundHexes.map((hex) => axialKey(hex.coord)))

  // ONE CAPITAL, THEN GROW. Enforced here and not merely previewed on the client, because the
  // client gate is a convenience and a direct POST would otherwise walk straight past it. Without
  // this, a buyer could scatter isolated tiles across the map and collect one full-size logo per
  // tile — strictly more advertising presence than a connected block of the same size and price.
  // See lib/hex/selectionEligibility.ts.
  // Scattering is allowed and charged for, not refused: each separate patch is its own billboard.
  // Computed server-side so the premium cannot be dodged by a hand-rolled request.
  const billboardCount = countDisconnectedGroups(foundHexes.map((hex) => hex.coord))

  for (const hex of foundHexes) {
    if (acquiringEmpire && hex.ownerId === acquiringEmpire.id) {
      return NextResponse.json({ success: false, error: 'You already control this hex' }, { status: 409 })
    }
    const others = new Set(basketKeys)
    others.delete(axialKey(hex.coord))
    const eligibility = checkSelectionEligibility(
      hex.coord,
      (coord) => neighborOwners.get(hexIdFor(coord)) ?? null,
      acquiringEmpire?.id ?? null,
      { selectedKeys: others },
    )
    if (!eligibility.eligible) {
      return NextResponse.json({ success: false, error: ELIGIBILITY_MESSAGES[eligibility.reason] }, { status: 409 })
    }
  }

  // Any shape, any size. Territory is priced per tile and summed, with marginal volume tiers, so
  // more ground always costs more — see lib/pricing/takeoverPricing.ts. The previous rule rejected
  // anything that was not exactly one tile or a perfect 7/19 ring, which made a four-tile claim
  // impossible to buy.
  const selectionPrice = priceForSelection(foundHexes, billboardCount)
  const amountCents =
    selectionPrice.totalCents + (parsedBody.data.protect ? PROTECTION_FEE_CENTS * foundHexes.length : 0)

  const paddleConfig = readPaddleConfig()

  // A failed scrape must NOT block a purchase. Plenty of real sites rate-limit or block bots
  // outright, and refusing the sale because we could not read their og:title would turn their
  // WAF configuration into a reason they cannot give us money. Fall back to the hostname and the
  // public favicon service, which needs no cooperation from the target at all.
  const metadata = await resolveBrandMetadata(parsedUrl.url).catch(() => {
    const hostname = new URL(parsedUrl.url).hostname
    logger.warn('brand scrape failed at checkout — falling back to hostname', { hostname })
    return {
      title: hostname,
      description: `Territory on Hex Wars, controlled by ${hostname}.`,
      logoUrl: `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`,
      sourceUrl: parsedUrl.url,
    }
  })

  if (!paddleConfig) {
    // Demo mode: no payment provider configured, so no payment is taken and none is claimed. The
    // takeover is applied for real against the database so the game loop is playable locally.
    //
    // This grants territory for free, so it is deliberately NOT a separate endpoint: it sits after
    // every check above (rate limit, consent, hex existence, protection lock, adjacency, cluster
    // validity, server-computed price) and is reachable only when `readPaddleConfig()` returns
    // null. Adding a payment key is what closes it — there is no flag to forget.
    const empire = await empireRepository.getOrCreateForUrl(parsedUrl.url, metadata)
    const now = new Date().toISOString()
    const lockedUntil = parsedBody.data.protect
      ? new Date(Date.now() + PROTECTION_DURATION_MS).toISOString()
      : null

    for (const hex of foundHexes) {
      const price = requiredPriceForHex(hex)
      const defenderId = hex.ownerId
      await hexRepository.applyTakeover(hex.id, {
        ownerId: empire.id,
        lastPricePaidCents: price,
        isContested: false,
        ownedSince: now,
        lockedUntil,
      })
      await hexRepository.recordTakeover({
        coord: hex.coord,
        attackerEmpireId: empire.id,
        defenderEmpireId: defenderId,
        pricePaidCents: price,
      })
    }

    return NextResponse.json({
      success: true,
      code: 'demo_applied',
      data: { amountCents, hexIds: parsedBody.data.hexIds, empireId: empire.id },
    })
  }

  try {
    const transaction = await createPaddleTransaction(
      {
        amountCents,
        currencyCode: process.env.PADDLE_CURRENCY_CODE ?? 'USD',
        description:
          parsedBody.data.hexIds.length === 1
            ? 'Hex Wars — 1 hex'
            : `Hex Wars — ${parsedBody.data.hexIds.length} hexes`,
        customData: {
          hexIds: parsedBody.data.hexIds,
          targetUrl: metadata.sourceUrl,
          scrapedTitle: metadata.title,
          scrapedDescription: metadata.description,
          protect: parsedBody.data.protect,
          // Durable evidence of the Terms §5 withdrawal-waiver consent, tied to this specific
          // payment — the thing actually worth having on hand if a chargeback later disputes it.
          agreedToTermsAt: new Date().toISOString(),
          // Compare-and-swap fingerprint: the webhook refuses to apply this takeover if the hexes
          // changed hands, changed price, or became protected while the payment was in flight.
          expectedHexState: JSON.stringify(fingerprintHexes(foundHexes)),
        },
        successUrl: process.env.CHECKOUT_SUCCESS_URL ?? 'https://example.com/checkout/complete',
      },
      paddleConfig,
    )
    return NextResponse.json({ success: true, data: { checkoutUrl: transaction.checkoutUrl, amountCents } })
  } catch (error: unknown) {
    // Log the real upstream detail server-side; return a generic message. The thrown error can
    // embed the provider's raw response body, which must not be echoed to an anonymous caller.
    logger.error('Paddle transaction creation failed', {
      detail: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ success: false, error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }
}
