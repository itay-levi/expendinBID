import { guardedFetch } from '@/lib/security/guardedFetch'
import { rateLimit, clientKeyFromRequest, tooManyRequests } from '@/lib/security/rateLimit'

// Node runtime: the SSRF guard uses node:dns/node:net, which the Edge runtime lacks.
export const runtime = 'nodejs'

const FETCH_TIMEOUT_MS = 5_000
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3

// Raster and vector formats a browser can decode into a WebGL texture. Anything else — HTML, SVG
// with scripts, an unknown type — is rejected rather than passed through, so this endpoint can
// never be used to serve attacker-chosen active content from this origin.
const ALLOWED_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/x-icon',
  'image/vnd.microsoft.icon',
])

/**
 * Same-origin proxy for brand logos.
 *
 * WebGL refuses to sample a cross-origin image unless the remote host sends CORS headers, and the
 * logo sources this app relies on mostly don't: Google's favicon service sends no
 * `Access-Control-Allow-Origin` at all, and an arbitrary buyer's `og:image` is a coin flip. That
 * is why occupied hexes only ever showed the locally-drawn fallback plaque — every real logo load
 * failed the CORS check and fell back silently.
 *
 * Re-fetching through this route makes the image same-origin, so it loads into a texture normally.
 * It carries the same SSRF protections as the metadata scraper (ARCHITECTURE.md §15): this is
 * still "fetch a URL a stranger supplied", and the fact that the URL came from our own scraper
 * doesn't change that — the scraper got it from the stranger's page.
 */
export async function GET(request: Request): Promise<Response> {
  const limit = rateLimit(clientKeyFromRequest(request, 'brand-logo'), 60, 60_000)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds)

  const rawUrl = new URL(request.url).searchParams.get('url')
  if (!rawUrl) return jsonError('Missing "url" query parameter', 400)

  let target: URL
  try {
    target = new URL(rawUrl)
  } catch {
    return jsonError('Malformed URL', 400)
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return jsonError('Only http and https URLs are supported', 400)
  }

  try {
    const image = await fetchImageWithGuards(target.toString())
    // Copied into a plain ArrayBuffer: a Uint8Array view isn't a valid BodyInit on its own.
    const body = image.body.buffer.slice(
      image.body.byteOffset,
      image.body.byteOffset + image.body.byteLength,
    ) as ArrayBuffer
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': image.contentType,
        'Content-Length': String(image.body.byteLength),
        // Logos change rarely and every viewer of a hex requests the same one.
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        // Belt and braces: this route only ever emits images, never a document to be interpreted.
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not fetch that image'
    return jsonError(message, 422)
  }
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Downloads the image through the connect-time SSRF guard (lib/security/guardedFetch.ts): the
 * address is validated inside the socket's own DNS lookup, every redirect hop is re-checked, and
 * the body is capped. Only image types a browser can decode into a texture are accepted.
 */
async function fetchImageWithGuards(targetUrl: string): Promise<{ body: Uint8Array; contentType: string }> {
  const response = await guardedFetch(targetUrl, {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxBytes: MAX_IMAGE_BYTES,
    maxRedirects: MAX_REDIRECTS,
    accept: 'image/avif,image/webp,image/png,image/*;q=0.8',
  })
  if (!response.ok) throw new Error(`Logo host responded with ${response.status}`)
  if (!ALLOWED_CONTENT_TYPES.has(response.contentType)) {
    throw new Error(`Unsupported logo content type: ${response.contentType || 'unknown'}`)
  }
  return { body: response.body, contentType: response.contentType }
}
