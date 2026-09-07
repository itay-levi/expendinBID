import { describe, expect, it } from 'vitest'
import { checkHostIsSafeToFetch } from './ssrfGuard'

// These assert on literal IPs, which take the no-DNS path and so are hermetic (no network).
describe('checkHostIsSafeToFetch — literal IP addresses', () => {
  const blocked = [
    ['loopback v4', '127.0.0.1'],
    ['loopback range', '127.9.9.9'],
    ['private 10/8', '10.0.0.5'],
    ['private 172.16/12 low', '172.16.0.1'],
    ['private 172.16/12 high', '172.31.255.254'],
    ['private 192.168/16', '192.168.1.1'],
    ['cloud metadata', '169.254.169.254'],
    ['link-local', '169.254.1.1'],
    ['this-network 0/8', '0.0.0.0'],
    ['IPv6 loopback', '::1'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv6 unique-local fc00::/7', 'fd00::1'],
    ['IPv4-mapped IPv6 loopback', '::ffff:127.0.0.1'],
    ['IPv4-mapped IPv6 private', '::ffff:10.0.0.1'],
  ] as const

  for (const [label, ip] of blocked) {
    it(`blocks ${label} (${ip})`, async () => {
      const result = await checkHostIsSafeToFetch(ip)
      expect(result.safe).toBe(false)
    })
  }

  const allowed = [
    ['public v4', '8.8.8.8'],
    ['public v4 edge of 172 range', '172.32.0.1'],
    ['public v4 just below 172.16', '172.15.255.255'],
    ['public v6', '2606:4700:4700::1111'],
  ] as const

  for (const [label, ip] of allowed) {
    it(`allows ${label} (${ip})`, async () => {
      const result = await checkHostIsSafeToFetch(ip)
      expect(result.safe).toBe(true)
    })
  }

  it('blocks the literal hostname localhost', async () => {
    expect((await checkHostIsSafeToFetch('localhost')).safe).toBe(false)
    expect((await checkHostIsSafeToFetch('LOCALHOST')).safe).toBe(false)
  })

  it('blocks a hostname that cannot be resolved rather than failing open', async () => {
    const result = await checkHostIsSafeToFetch('definitely-not-a-real-host.invalid')
    expect(result.safe).toBe(false)
  })
})
