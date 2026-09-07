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

/** Exported for testing: this is where untrusted third-party HTML is turned into displayed text. */
export function extractMeta(html: string, url: string): { title: string; description: string; logoUrl: string | null } {
  const head = html.slice(0, 100_000) // metadata always lives near the top; avoids scanning huge bodies

  const ogTitle = head.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i)?.[1]
  const titleTag = head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]
  const ogDescription = head.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)?.[1]
  const metaDescription = head.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]
  const ogImage = head.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i)?.[1]
  const appleTouchIcon = head.match(/<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']*)["']/i)?.[1]

  let logoUrl: string | null = null
  if (ogImage) logoUrl = new URL(ogImage, url).toString()
  else if (appleTouchIcon) logoUrl = new URL(appleTouchIcon, url).toString()

  return {
    title: decodeHtmlEntities((ogTitle ?? titleTag ?? '').trim()).slice(0, 120),
    description: decodeHtmlEntities((ogDescription ?? metaDescription ?? '').trim()).slice(0, 240),
    logoUrl,
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
