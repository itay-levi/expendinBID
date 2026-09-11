import http from 'node:http'
import zlib from 'node:zlib'
import type { AddressInfo } from 'node:net'
import type dns from 'node:dns'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSafeLookup, guardedFetch } from './guardedFetch'
import { isPrivateOrReservedIp } from './ssrfGuard'

/** A resolver that answers with a fixed record set, standing in for attacker-controlled DNS. */
function fakeResolver(addresses: string[]): typeof dns.lookup {
  return ((_host: string, _options: unknown, callback: (e: Error | null, a: dns.LookupAddress[]) => void) =>
    callback(
      null,
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    )) as unknown as typeof dns.lookup
}

function runLookup(lookup: ReturnType<typeof createSafeLookup>, all: boolean) {
  return new Promise<{ error: Error | null; result: unknown }>((resolve) => {
    ;(lookup as unknown as (h: string, o: object, cb: (...args: unknown[]) => void) => void)(
      'rebind.example',
      { all },
      (error, address) => resolve({ error: (error as Error | null) ?? null, result: address }),
    )
  })
}

const allowPublic = (ip: string) => !isPrivateOrReservedIp(ip)

describe('createSafeLookup', () => {
  it('passes a public address through', async () => {
    const { error, result } = await runLookup(createSafeLookup(allowPublic, fakeResolver(['93.184.216.34'])), false)
    expect(error).toBeNull()
    expect(result).toBe('93.184.216.34')
  })

  it('refuses cloud metadata even though the name looked innocent', async () => {
    // The rebinding answer: the connection-time resolution returns the metadata service.
    const { error } = await runLookup(createSafeLookup(allowPublic, fakeResolver(['169.254.169.254'])), false)
    expect(error?.message).toMatch(/private address/)
  })

  it('refuses a record set that mixes public and private addresses', async () => {
    const lookup = createSafeLookup(allowPublic, fakeResolver(['93.184.216.34', '10.0.0.5']))
    const { error } = await runLookup(lookup, true)
    expect(error?.message).toMatch(/private address/)
  })

  it('returns the full list when Node asks for all addresses', async () => {
    const { error, result } = await runLookup(createSafeLookup(allowPublic, fakeResolver(['93.184.216.34'])), true)
    expect(error).toBeNull()
    expect(result).toEqual([{ address: '93.184.216.34', family: 4 }])
  })
})

describe('guardedFetch', () => {
  let server: http.Server
  let base: string
  // Loopback is exactly what production refuses, so tests that need a real server opt it back in.
  const opts = {
    timeoutMs: 2_000,
    maxBytes: 1_000,
    maxRedirects: 2,
    isAddressAllowed: (ip: string) => ip === '127.0.0.1',
  }

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      switch (req.url) {
        case '/ok':
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end('<title>hello</title>')
          return
        case '/gzip':
          res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' })
          res.end(zlib.gzipSync('<title>zipped</title>'))
          return
        case '/bomb':
          // 50 KB of zeros compresses to almost nothing — the cap must apply after decoding.
          res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' })
          res.end(zlib.gzipSync(Buffer.alloc(50_000)))
          return
        case '/big':
          res.writeHead(200, { 'content-type': 'text/html' })
          res.end('x'.repeat(5_000))
          return
        case '/hop':
          res.writeHead(302, { location: '/ok' })
          res.end()
          return
        case '/loop':
          res.writeHead(302, { location: '/loop' })
          res.end()
          return
        case '/to-metadata':
          res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
          res.end()
          return
        case '/slow':
          res.writeHead(200, { 'content-type': 'text/html' })
          res.write('a') // and never finishes
          return
        default:
          res.writeHead(404)
          res.end()
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('fetches a page', async () => {
    const response = await guardedFetch(`${base}/ok`, opts)
    expect(response.ok).toBe(true)
    expect(response.contentType).toBe('text/html')
    expect(response.body.toString()).toBe('<title>hello</title>')
  })

  it('decodes gzip', async () => {
    expect((await guardedFetch(`${base}/gzip`, opts)).body.toString()).toBe('<title>zipped</title>')
  })

  it('caps the body AFTER decompression, so a gzip bomb cannot expand past the limit', async () => {
    await expect(guardedFetch(`${base}/bomb`, opts)).rejects.toThrow('Response too large')
  })

  it('caps an uncompressed body too', async () => {
    await expect(guardedFetch(`${base}/big`, opts)).rejects.toThrow('Response too large')
  })

  it('follows a redirect and reports where it ended up', async () => {
    const response = await guardedFetch(`${base}/hop`, opts)
    expect(response.body.toString()).toBe('<title>hello</title>')
    expect(response.finalUrl).toBe(`${base}/ok`)
  })

  it('stops a redirect loop', async () => {
    await expect(guardedFetch(`${base}/loop`, opts)).rejects.toThrow('Too many redirects')
  })

  it('refuses a redirect into internal address space', async () => {
    await expect(guardedFetch(`${base}/to-metadata`, opts)).rejects.toThrow(/private address/)
  })

  it('enforces a hard deadline against a server that trickles', async () => {
    await expect(guardedFetch(`${base}/slow`, { ...opts, timeoutMs: 300 })).rejects.toThrow('Request timed out')
  })

  it('returns a failure status without downloading the body', async () => {
    const response = await guardedFetch(`${base}/missing`, opts)
    expect(response.ok).toBe(false)
    expect(response.status).toBe(404)
  })

  it('blocks loopback, localhost, credentials and non-web schemes under the production policy', async () => {
    const production = { timeoutMs: 1_000, maxBytes: 1_000, maxRedirects: 0 }
    await expect(guardedFetch(`${base}/ok`, production)).rejects.toThrow(/private address/)
    await expect(guardedFetch('http://localhost/', production)).rejects.toThrow('Host is not eligible')
    await expect(guardedFetch('file:///etc/passwd', production)).rejects.toThrow('Only http and https')
    await expect(guardedFetch('http://user:pw@example.com/', production)).rejects.toThrow('credentials')
    await expect(guardedFetch('not a url', production)).rejects.toThrow('Malformed URL')
  })
})
