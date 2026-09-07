import { checkHostIsSafeToFetch } from '@/lib/security/ssrfGuard'

const FETCH_TIMEOUT_MS = 5_000
const MAX_RESPONSE_BYTES = 2_000_000 // 2MB cap — a brand's <head> never legitimately needs more
const MAX_REDIRECTS = 3

export type ResolvedBrandMetadata = { title: string; description: string; logoUrl: string; sourceUrl: string }

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export type IconCandidate = { href: string; sizePx: number; rank: number }

/**
 * Every square-mark candidate in a page's head, best first.
 *
 * `rank` encodes what KIND of image it is, and it beats size: an `apple-touch-icon` is by
 * definition a square app icon somebody designed to represent the brand, whereas `og:image` is a
 * social share banner — outrank.so's is 2400x1200, which is a marketing card, not a logo. Ranking
 * og:image above icons (as this used to) meant picking the banner over the actual mark and then
 * squashing a 2:1 image into a hexagon.
 */
export function extractIconCandidates(head: string, url: string): IconCandidate[] {
  const candidates: IconCandidate[] = []

  const push = (href: string | undefined, rank: number, sizes?: string) => {
    if (!href) return
    try {
      // Resolved against the page URL: icons are usually declared as root-relative paths.
      const absolute = new URL(decodeHtmlEntities(href.trim()), url).toString()
      // "192x192", or "any" for SVG, which is infinitely scalable and so ranks above any raster.
      const match = /(\d+)\s*x\s*\d+/i.exec(sizes ?? '')
      const sizePx = (sizes ?? '').trim().toLowerCase() === 'any' ? 1024 : match ? Number(match[1]) : 0
      candidates.push({ href: absolute, sizePx, rank })
    } catch {
      // A malformed href is simply not a candidate.
    }
  }

  // Every <link> whose rel mentions an icon, with its sizes attribute if present. Attribute order
  // varies between frameworks, so href and sizes are read from the whole tag rather than assumed
  // to follow rel.
  for (const tag of head.match(/<link[^>]+>/gi) ?? []) {
    const rel = /rel=["']([^"']*)["']/i.exec(tag)?.[1]?.toLowerCase()
    if (!rel || !/icon/.test(rel)) continue
    const href = /href=["']([^"']*)["']/i.exec(tag)?.[1]
    const sizes = /sizes=["']([^"']*)["']/i.exec(tag)?.[1]
    if (/mask-icon/.test(rel)) continue // monochrome Safari pinned-tab glyph, never a colour logo
    push(href, /apple-touch-icon/.test(rel) ? 3 : 2, sizes)
  }

  // Explicit logo declarations, where a site bothers to publish one.
  push(/<meta[^>]+property=["']og:logo["'][^>]+content=["']([^"']*)["']/i.exec(head)?.[1], 4)
  push(/<meta[^>]+itemprop=["']logo["'][^>]+content=["']([^"']*)["']/i.exec(head)?.[1], 4)

  // Last resort. A share banner is better than nothing, but it is the wrong shape and usually
  // carries a headline rather than a mark.
  push(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i.exec(head)?.[1], 1)

  return candidates.sort((a, b) => b.rank - a.rank || b.sizePx - a.sizePx)
}

/** Exported for testing: this is where untrusted third-party HTML is turned into displayed text. */
export function extractMeta(html: string, url: string): { title: string; description: string; logoUrl: string | null } {
  const head = html.slice(0, 100_000) // metadata always lives near the top; avoids scanning huge bodies

  const ogTitle = head.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i)?.[1]
  const titleTag = head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]
  const ogDescription = head.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)?.[1]
  const metaDescription = head.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]

  return {
    title: decodeHtmlEntities((ogTitle ?? titleTag ?? '').trim()).slice(0, 120),
    description: decodeHtmlEntities((ogDescription ?? metaDescription ?? '').trim()).slice(0, 240),
    logoUrl: extractIconCandidates(head, url)[0]?.href ?? null,
  }
}

async function fetchWithGuards(targetUrl: string, redirectsLeft: number): Promise<{ html: string; finalUrl: string }> {
  const parsed = new URL(targetUrl)
  const hostCheck = await checkHostIsSafeToFetch(parsed.hostname)
  if (!hostCheck.safe) throw new Error(hostCheck.reason)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(targetUrl, {
      signal: controller.signal,
      redirect: 'manual', // handle redirects ourselves so every hop gets re-checked, not just the first
      headers: { 'User-Agent': 'HexWarsBrandBot/1.0 (+https://hexwars.example/bot)' },
    })

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new Error('Redirect with no location')
      if (redirectsLeft <= 0) throw new Error('Too many redirects')
      return fetchWithGuards(new URL(location, targetUrl).toString(), redirectsLeft - 1)
    }

    if (!response.ok) throw new Error(`Target responded with ${response.status}`)

    const reader = response.body?.getReader()
    if (!reader) throw new Error('Empty response')

    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('Response too large')
      }
      chunks.push(value)
    }

    const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8')
    return { html, finalUrl: targetUrl }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * The single authoritative source for a URL's brand metadata — used both for the pre-payment
 * preview (app/api/brand/resolve) and, re-resolved server-side again, when the checkout session
 * is created (app/api/checkout/create-session). Never trust client-supplied title/description for
 * the copy that actually gets embedded in a payment or shown on the map — always re-derive it here.
 */
export async function resolveBrandMetadata(targetUrl: string): Promise<ResolvedBrandMetadata> {
  const { html, finalUrl } = await fetchWithGuards(targetUrl, MAX_REDIRECTS)
  const meta = extractMeta(html, finalUrl)
  const finalHost = new URL(finalUrl).hostname

  return {
    title: meta.title || finalHost,
    description: meta.description || `Live territory on Hex Wars, controlled by ${finalHost}.`,
    logoUrl: meta.logoUrl ?? `https://www.google.com/s2/favicons?domain=${finalHost}&sz=128`,
    sourceUrl: finalUrl,
  }
}
