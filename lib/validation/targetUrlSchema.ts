import { z } from 'zod'

// The acquisition form's only input, per the product spec: a single "Target Website URL" field —
// no manual text, no uploads.
//
// This is the client-facing boundary. checkHostIsSafeToFetch (lib/security/ssrfGuard.ts) is still
// the authority server-side (it resolves DNS, which this cannot), but this must not wave through
// input the server will reject — and it must not be bypassable by scheme trickery.

const MAX_URL_LENGTH = 2048

/** A scheme is "already present" only if it looks like one per RFC 3986, not just "starts with http". */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** Hostnames that must never be targeted, checked before DNS ever happens. */
const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', '0.0.0.0', '127.0.0.1', '::1', '[::1]'])

/** Rejects anything that isn't a plain hostname or IP literal — including HTML-significant characters. */
const SAFE_HOST = /^[a-z0-9.\-[\]:]+$/i

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (BLOCKED_HOSTNAMES.has(host)) return true
  if (host === 'localhost' || host.endsWith('.localhost')) return true

  // Literal private/loopback/link-local IPv4. The server re-checks post-DNS; this catches the
  // obvious direct attempts at the boundary so the UI gives an honest answer immediately.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
  }
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd') || host === '::1') return true

  return false
}

export type ParsedTargetUrl = { success: true; url: string; hostname: string } | { success: false; error: string }

export function parseTargetUrl(input: string): ParsedTargetUrl {
  const trimmed = (input ?? '').trim()
  if (trimmed.length === 0) return { success: false, error: 'Enter a website URL' }
  if (trimmed.length > MAX_URL_LENGTH) return { success: false, error: 'URL is too long' }

  // Only prepend a scheme when there genuinely isn't one. Prepending unconditionally is how
  // "file:///etc/passwd" turns into a string that parses as https and slips past a scheme check.
  const candidate = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { success: false, error: 'Enter a valid URL, e.g. https://mycompany.com' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { success: false, error: 'Only http and https URLs are supported' }
  }
  if (parsed.username || parsed.password) {
    return { success: false, error: 'Credentials in URLs are not supported' }
  }
  // Canonicalize the fully-qualified form: `brand.com.` is the same site as `brand.com`, but a
  // different string — so it became a separate empire, slipped past the chargeback blocklist, and
  // (as `localhost.`) past the blocked-host check below. Stripped here, before any check runs,
  // because this is where every identity in the app is derived from.
  parsed.hostname = parsed.hostname.replace(/\.+$/, '')
  if (!parsed.hostname) {
    return { success: false, error: 'Enter a valid URL, e.g. https://mycompany.com' }
  }
  if (!SAFE_HOST.test(parsed.hostname)) {
    return { success: false, error: 'That host is not eligible' }
  }
  if (isBlockedHost(parsed.hostname)) {
    return { success: false, error: 'That host is not eligible' }
  }
  if (parsed.href.length > MAX_URL_LENGTH) {
    return { success: false, error: 'URL is too long' }
  }

  return { success: true, url: parsed.href, hostname: parsed.hostname.toLowerCase() }
}

/** Zod wrapper for API route bodies, so route schemas reuse exactly the same rules. */
export const targetUrlSchema = z.string().superRefine((value, ctx) => {
  const result = parseTargetUrl(value)
  if (!result.success) ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error })
})
