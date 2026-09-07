import dns from 'node:dns/promises'
import net from 'node:net'

// Shared by every server-side feature that fetches a URL on a user's behalf (brand metadata
// scraping today; anything similar later). Validating the input hostname is not sufficient on
// its own — an attacker-controlled DNS record can resolve a "safe-looking" hostname to a private
// IP after the check runs (DNS rebinding), so the resolved address must be re-checked too.

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain'])

function isPrivateOrReservedIp(ip: string): boolean {
  const type = net.isIP(ip)
  if (type === 4) {
    const octets = ip.split('.').map(Number)
    const [a, b] = octets as [number, number, number, number]
    if (a === 127) return true // loopback
    if (a === 10) return true // private
    if (a === 172 && b >= 16 && b <= 31) return true // private
    if (a === 192 && b === 168) return true // private
    if (a === 169 && b === 254) return true // link-local / cloud metadata (169.254.169.254)
    if (a === 0) return true
    return false
  }
  if (type === 6) {
    const lower = ip.toLowerCase()
    if (lower === '::1') return true // loopback
    if (lower.startsWith('fe80:')) return true // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique local
    if (lower.startsWith('::ffff:')) return isPrivateOrReservedIp(lower.slice(7)) // IPv4-mapped
    return false
  }
  return true // not a parseable IP — treat as unsafe rather than silently allow
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
