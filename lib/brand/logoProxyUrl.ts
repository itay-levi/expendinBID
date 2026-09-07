/**
 * Rewrites a brand logo URL to load through this app's own origin (app/api/brand/logo).
 *
 * Necessary because WebGL will not sample a cross-origin image without CORS headers, and the logo
 * sources here largely don't send them — see the route's doc comment. Data URIs are returned
 * untouched: they're already same-origin by definition, and round-tripping one through the proxy
 * would be pointless work.
 */
export function logoProxyUrl(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null
  if (logoUrl.startsWith('data:')) return logoUrl
  if (logoUrl.startsWith('/')) return logoUrl
  if (!/^https?:\/\//i.test(logoUrl)) return null
  return `/api/brand/logo?url=${encodeURIComponent(logoUrl)}`
}
