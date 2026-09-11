import dns from 'node:dns/promises'
import net from 'node:net'

// Shared by every server-side feature that fetches a URL on a user's behalf (brand metadata
// scraping today; anything similar later). Validating the input hostname is not sufficient on
// its own — an attacker-controlled DNS record can resolve a "safe-looking" hostname to a private
// IP after the check runs (DNS rebinding), so the resolved address must be re-checked too.

export const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain'])

/**
 * True for any address a server-side fetch must never connect to.
 *
 * Loopback, RFC1918, link-local (169.254.169.254 is AWS/GCP/Azure instance metadata), carrier-grade
 * NAT (100.64.0.0/10 - Alibaba Cloud metadata lives at 100.100.100.200), benchmarking, multicast
 * and reserved space, the IPv6 equivalents, and the two IPv6 forms that smuggle an IPv4 address
 * through: IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::/96). Unparseable input is refused.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const type = net.isIP(ip)
  if (type === 4) {
    const [a, b, c] = ip.split('.').map(Number) as [number, number, number, number]
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 192 && b === 0 && c === 0) return true
    if (a === 198 && (b === 18 || b === 19)) return true
    if (a >= 224) return true
    return false
  }
  if (type === 6) {
    const lower = ip.toLowerCase()
    if (lower === '::' || lower === '::1') return true
    if (/^fe[89ab]/.test(lower)) return true
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true
    if (lower.startsWith('ff')) return true
    if (lower.startsWith('64:ff9b:')) return true
    if (lower.startsWith('::ffff:')) return isPrivateOrReservedIp(lower.slice(7))
    return false
  }
  return true
}

export type SsrfCheckResult = { safe: true; resolvedIp: string } | { safe: false; reason: string }

/**
 * Resolves `hostname` and confirms the address it actually points to is a public, routable IP.
 * Call this immediately before making the outbound request — not just at input-validation time —
 * so a DNS record that changes between validation and fetch can't slip a private address through.
 */
export async function checkHostIsSafeToFetch(hostname: string): Promise<SsrfCheckResult> {
  const lower = hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(lower)) return { safe: false, reason: 'Host is not eligible' }

  if (net.isIP(lower)) {
    if (isPrivateOrReservedIp(lower)) return { safe: false, reason: 'Host resolves to a private address' }
    return { safe: true, resolvedIp: lower }
  }

  let addresses: string[]
  try {
    const records = await dns.lookup(lower, { all: true })
    addresses = records.map((r) => r.address)
  } catch {
    return { safe: false, reason: 'Host could not be resolved' }
  }

  if (addresses.length === 0) return { safe: false, reason: 'Host could not be resolved' }
  const unsafe = addresses.find(isPrivateOrReservedIp)
  if (unsafe) return { safe: false, reason: 'Host resolves to a private address' }

  return { safe: true, resolvedIp: addresses[0] as string }
}
