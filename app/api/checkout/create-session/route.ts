import { NextResponse } from 'next/server'
import { z } from 'zod'
import { parseTargetUrl } from '@/lib/validation/targetUrlSchema'
import { resolveBrandMetadataOrFallback } from '@/lib/brand/resolveBrandMetadata'
import { normalizeBrandColor } from '@/lib/brand/dominantColor'
import { hexIdFor } from '@/lib/hex/hexIdentity'
import { checkSelectionEligibility, countDisconnectedGroups } from '@/lib/hex/selectionEligibility'
import { ELIGIBILITY_MESSAGES } from '@/lib/hex/territoryEligibility'
import { fingerprintHexes, parseFingerprints } from '@/lib/hex/takeoverGuard'
import { axialKey } from '@/lib/hex/hexMath'
import { assertTakeoverAllowed, quoteForHexes } from '@/lib/pricing/takeoverPricing'
import { getRepositories } from '@/lib/repository'
import { createDodoCheckoutSession } from '@/lib/payments/dodoClient'
import { createPaddleTransaction } from '@/lib/payments/paddleClient'
import { selectPaymentProvider, siteOrigin } from '@/lib/payments/paymentProvider'
import { settleTakeover } from '@/lib/payments/settleTakeover'
import { BodyTooLargeError, readBodyWithLimit } from '@/lib/http/readBodyWithLimit'
import { logger } from '@/lib/logger'
import { rateLimit, clientKeyFromRequest, tooManyRequests } from '@/lib/security/rateLimit'

/** A basket of 200 tiles with a URL and a colour is a few kilobytes. */
const MAX_BODY_BYTES = 32 * 1024

// Computes the charge server-side from the current, authoritative hex state — the client sends
// only *which* hexes and *whether* to add protection; it never sends an amount. This is the same
// principle as the rest of the pricing system (ARCHITECTURE.md §8/§12): a client-submitted price
// is a UI preview, never payment authorization.
const requestSchema = z.object({
  // Generous but bounded: a claim of any shape is allowed, but one request may not ask the server
  // to price and write an unbounded number of tiles. Duplicates are refused — the same tile twice
  // would be priced twice and could never settle.
  hexIds: z
    .array(z.string().max(32))
    .min(1)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate tiles in selection'),
  url: z.string().max(4096),
  protect: z.boolean().optional().default(false),
  // Must be checked, not just present-and-truthy-ish — a missing or false value is rejected below
  // with its own message rather than falling through to the generic "Invalid request body" error,
  // since this is a distinct, user-actionable condition (go back and check the box), not malformed input.
  agreedToTerms: z.boolean(),
  // Sampled from the buyer's own logo in their browser, because that is where the pixels are.
  // Cosmetic and self-affecting, so a bad value is not worth failing a purchase over — it is
  // normalized rather than rejected. Optional: a blocked scraper must still be able to buy.
  primaryColorHex: z.string().max(16).optional(),
})

// Node runtime: the SSRF guard reached from here uses node:dns/node:net.
export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  // Each call creates a payment-provider session and triggers an outbound scrape, so it is both
  // costly and abusable. Also stops rapid-fire probing of hex prices/eligibility across the map.
  const limit = rateLimit(clientKeyFromRequest(request, 'checkout'), 8, 60_000)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds)

  let json: unknown = null
  try {
    json = JSON.parse(await readBodyWithLimit(request, MAX_BODY_BYTES))
  } catch (error: unknown) {
    if (error instanceof BodyTooLargeError) {
      return NextResponse.json({ success: false, error: 'Request too large' }, { status: 413 })
    }
    // Unparseable JSON falls through as null and is rejected by the schema below.
  }
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

  const { hexes: hexRepository, empires: empireRepository, audit } = await getRepositories()

  // Before anything is priced or scraped: a domain blocked for a chargeback gets nothing.
  if (await audit.isDomainBlocked(new URL(parsedUrl.url).hostname)) {
    return NextResponse.json(
      { success: false, error: 'This website can no longer purchase territory on Hex Wars.' },
      { status: 403 },
    )
  }

  // One batched lookup for the whole basket rather than a round trip per tile.
  const byId = await hexRepository.getHexesByIds(parsedBody.data.hexIds)
  const missing = parsedBody.data.hexIds.find((id) => !byId.has(id))
  if (missing) {
    return NextResponse.json({ success: false, error: `Unknown hex: ${missing}` }, { status: 404 })
  }
  const foundHexes = parsedBody.data.hexIds.map((id) => byId.get(id)!)

  try {
    foundHexes.forEach((hex) => assertTakeoverAllowed(hex))
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Hex unavailable' },
      { status: 409 },
    )
  }

  // Territorial adjacency rule (ARCHITECTURE.md §23), enforced here and not merely previewed: the
  // client's hover/click gating is a UX convenience, and a direct API call has to be stopped here.
  const acquiringEmpire = await empireRepository.findByUrl(parsedUrl.url)

  // Only the neighbours of the requested hexes are fetched, never the whole map. The map is
  // unbounded, so a full read is a query whose cost grows with total sales.
  const neighborOwners = await hexRepository.getNeighborOwners(foundHexes.map((hex) => hex.coord))
  // Hexes in the same basket count toward each other's reachability: buying a border tile and the
  // one behind it in one transaction is how a buyer fights inward. Mirrors the client preview in
  // lib/hex/selectionEligibility.ts and settlement in lib/payments/settleTakeover.ts.
  const basketKeys = new Set(foundHexes.map((hex) => axialKey(hex.coord)))

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
      { selectedKeys: others, targetOwnerId: hex.ownerId },
    )
    if (!eligibility.eligible) {
      return NextResponse.json({ success: false, error: ELIGIBILITY_MESSAGES[eligibility.reason] }, { status: 409 })
    }
  }

  // Any shape, any size, priced by the one function settlement and the webhook amount check also
  // use — see lib/pricing/takeoverPricing.ts.
  const amountCents = quoteForHexes(foundHexes, billboardCount, parsedBody.data.protect).totalCents

  const provider = selectPaymentProvider()
  if (provider.kind === 'unconfigured') {
    // A production deploy with no payment provider takes no orders. It used to fall into free
    // demo claims instead; see isDemoModeAllowed.
    logger.error('checkout refused: no payment provider configured and demo mode is not enabled')
    return NextResponse.json({ success: false, error: 'Checkout is temporarily unavailable.' }, { status: 503 })
  }

  // A failed scrape must NOT block a purchase: plenty of real sites block bots, and their WAF
  // settings are not a reason they cannot give us money. Falls back to the hostname.
  const metadata = await resolveBrandMetadataOrFallback(parsedUrl.url)
  const brandColor = normalizeBrandColor(parsedBody.data.primaryColorHex)
  // Compare-and-swap fingerprint: settlement refuses this purchase if the tiles changed hands,
  // changed price, or became protected while the buyer was paying.
  const expectedHexState = JSON.stringify(fingerprintHexes(foundHexes))
  // The URL the buyer typed, not the one the scraper was redirected to. Checkout judged
  // reachability as this identity, so settlement must act as it too — `see.io` redirecting to
  // `www.see.io` is a different empire, and the mismatch refused expansions that had been paid for.
  const targetUrl = parsedUrl.url

  if (provider.kind === 'demo') {
    // Demo mode: no payment is taken and none is claimed. Settled through exactly the path a real
    // payment takes, so the game loop is playable locally and demo behaviour cannot drift from
    // production. Reachable only when isDemoModeAllowed() — never by default in production.
    const settlement = await settleTakeover(
      { hexes: hexRepository, empires: empireRepository },
      {
        hexIds: parsedBody.data.hexIds,
        targetUrl,
        metadata,
        primaryColorHex: brandColor,
        protect: parsedBody.data.protect,
        expected: parseFingerprints(expectedHexState),
      },
    )
    if (!settlement.applied) {
      return NextResponse.json(
        { success: false, error: 'Those tiles just changed hands — please pick them again.' },
        { status: 409 },
      )
    }
    return NextResponse.json({
      success: true,
      code: 'demo_applied',
      data: { amountCents, hexIds: parsedBody.data.hexIds, empireId: settlement.empire.id },
    })
  }

  // Durable evidence of the Terms §5 withdrawal-waiver consent, tied to this specific payment —
  // the thing actually worth having on hand if a chargeback later disputes it.
  const agreedToTermsAt = new Date().toISOString()
  const origin = siteOrigin(request)

  try {
    if (provider.kind === 'dodo') {
      const session = await createDodoCheckoutSession(
        {
          amountCents,
          returnUrl: `${origin}/checkout/complete`,
          cancelUrl: `${origin}/`,
          metadata: {
            hexIds: JSON.stringify(parsedBody.data.hexIds),
            targetUrl,
            protect: parsedBody.data.protect,
            primaryColorHex: brandColor,
            expectedHexState,
            quotedTotalCents: amountCents,
            agreedToTermsAt,
          },
        },
        provider.config,
      )
      return NextResponse.json({ success: true, data: { checkoutUrl: session.checkoutUrl, amountCents } })
    }

    const transaction = await createPaddleTransaction(
      {
        amountCents,
        currencyCode: process.env.PADDLE_CURRENCY_CODE ?? 'USD',
        description:
          parsedBody.data.hexIds.length === 1 ? 'Hex Wars — 1 hex' : `Hex Wars — ${parsedBody.data.hexIds.length} hexes`,
        customData: {
          hexIds: parsedBody.data.hexIds,
          targetUrl,
          scrapedTitle: metadata.title,
          scrapedDescription: metadata.description,
          protect: parsedBody.data.protect,
          primaryColorHex: brandColor,
          agreedToTermsAt,
          expectedHexState,
          // What settlement checks the collected amount against, as the Dodo path does.
          quotedTotalCents: amountCents,
        },
        successUrl: process.env.CHECKOUT_SUCCESS_URL || `${origin}/checkout/complete`,
      },
      provider.config,
    )
    return NextResponse.json({ success: true, data: { checkoutUrl: transaction.checkoutUrl, amountCents } })
  } catch (error: unknown) {
    // Log the real upstream detail server-side; return a generic message. The thrown error can
    // embed the provider's raw response body, which must not be echoed to an anonymous caller.
    logger.error('checkout session creation failed', {
      provider: provider.kind,
      detail: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ success: false, error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }
}
