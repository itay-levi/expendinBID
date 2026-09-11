import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { guardedFetch } from './guardedFetch'

describe('guardedFetch POST', () => {
  let server: http.Server
  let base: string
  const received: Array<{ method?: string; type?: string; body: string }> = []
  const loopbackOnly = { isAddressAllowed: (ip: string) => ip === '127.0.0.1' }

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(307, { location: '/elsewhere' })
        res.end()
        return
      }
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        received.push({ method: req.method, type: req.headers['content-type'], body })
        res.writeHead(204)
        res.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('sends a JSON body', async () => {
    const response = await guardedFetch(`${base}/hook`, {
      method: 'POST',
      jsonBody: JSON.stringify({ event: 'hex.annexed' }),
      timeoutMs: 2_000,
      maxBytes: 1_000,
      maxRedirects: 0,
      ...loopbackOnly,
    })
    expect(response.status).toBe(204)
    expect(received.at(-1)).toEqual({ method: 'POST', type: 'application/json', body: '{"event":"hex.annexed"}' })
  })

  it('never re-sends a POST body to a redirect target', async () => {
    const before = received.length
    const response = await guardedFetch(`${base}/redirect`, {
      method: 'POST',
      jsonBody: '{}',
      timeoutMs: 2_000,
      maxBytes: 1_000,
      maxRedirects: 5,
      ...loopbackOnly,
    })
    expect(response.status).toBe(307)
    expect(response.ok).toBe(false)
    expect(received.length).toBe(before)
  })
})
