import { NextResponse } from 'next/server'
import { parseTargetUrl } from '@/lib/validation/targetUrlSchema'
import { resolveBrandMetadata } from '@/lib/brand/resolveBrandMetadata'
import { rateLimit, clientKeyFromRequest, tooManyRequests } from '@/lib/security/rateLimit'

// Pre-payment preview endpoint: lets the buyer see the scraped title/description/logo for their
// URL before they pay. The checkout route re-resolves this independently server-side rather than
// trusting whatever this endpoint returned earlier — see resolveBrandMetadata.ts's doc comment.
// Node runtime: resolveBrandMetadata's SSRF guard uses node:dns/node:net, which Edge lacks.
export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  // This endpoint makes the server fetch an arbitrary URL on the caller's behalf. Unbounded, it
  // is a free outbound-request amplifier — usable to hammer a third party or to probe hosts at
  // volume — on top of being the most expensive endpoint here.
  const limit = rateLimit(clientKeyFromRequest(request, 'brand-resolve'), 40, 60_000)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const rawUrl = typeof body === 'object' && body !== null && 'url' in body ? (body as { url: unknown }).url : undefined
  if (typeof rawUrl !== 'string') {
    return NextResponse.json({ success: false, error: 'Missing "url" field' }, { status: 400 })
  }

  const parsed = parseTargetUrl(rawUrl)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error }, { status: 400 })
  }

  try {
    const resolved = await resolveBrandMetadata(parsed.url)
    return NextResponse.json({ success: true, data: resolved })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not resolve that URL'
    return NextResponse.json({ success: false, error: message }, { status: 422 })
  }
}
