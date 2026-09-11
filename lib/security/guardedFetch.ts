import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import zlib from 'node:zlib'
import { BLOCKED_HOSTNAMES, isPrivateOrReservedIp } from './ssrfGuard'

/**
 * Fetches a URL a stranger supplied, without letting it reach anything internal.
 *
 * This replaces two near-identical fetchers (the brand scraper and the logo proxy) that shared the
 * same hole: they validated the hostname's DNS answer, then called `fetch()`, which resolved the
 * hostname AGAIN to connect. An attacker who controls the domain's DNS can answer the first lookup
 * with a public address and the second with 169.254.169.254 — DNS rebinding — so the check passes
 * while the connection lands on cloud metadata.
 *
 * Here the address is validated inside the connection's own `lookup`, so the IP that was checked is
 * by construction the IP that gets connected to. There is no second resolution to race. Every
 * redirect hop goes back through the same path, and bodies are capped after decompression so a
 * small gzip bomb cannot expand past the limit.
 */

export type GuardedFetchOptions = {
  timeoutMs: number
  /** Cap on the DECODED body. Exceeding it aborts the transfer. */
  maxBytes: number
  maxRedirects: number
  accept?: string
  /** GET by default. POST is for outbound notifications; redirects are never followed for it. */
  method?: 'GET' | 'POST'
  /** JSON request body, for POST. */
  jsonBody?: string
  /** Test seam: which resolved addresses may be connected to. Production never overrides it. */
  isAddressAllowed?: (ip: string) => boolean
  /** Test seam: the resolver. Defaults to the OS resolver. */
  resolve?: typeof dns.lookup
}

export type GuardedResponse = {
  status: number
  ok: boolean
  finalUrl: string
  contentType: string
  body: Buffer
}

export class GuardedFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GuardedFetchError'
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const USER_AGENT = 'HexWarsBrandBot/1.0'

type LookupCallback = (error: Error | null, address?: string | dns.LookupAddress[], family?: number) => void

/**
 * A `lookup` for http.request that refuses to hand back any disallowed address.
 *
 * Every address the name resolves to must be allowed, not just the first: a record set mixing one
 * public and one private address would otherwise let the connection pick the private one. Handles
 * both call shapes Node uses — `all: true` when happy-eyeballs is on (the Node 20+ default), and
 * the single-address form otherwise.
 */
export function createSafeLookup(
  isAllowed: (ip: string) => boolean,
  resolve: typeof dns.lookup = dns.lookup,
): net.LookupFunction {
  const lookup = (hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
    const resolveAll = resolve as unknown as (
      host: string,
      opts: dns.LookupOptions,
      cb: (error: NodeJS.ErrnoException | null, addresses: unknown) => void,
    ) => void
    resolveAll(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) {
        callback(error)
        return
      }
      const list = Array.isArray(addresses) ? (addresses as dns.LookupAddress[]) : []
      if (list.length === 0 || list.some((entry) => !isAllowed(entry.address))) {
        callback(new GuardedFetchError('Host resolves to a private address'))
        return
      }
      if (options?.all) callback(null, list)
      else callback(null, list[0]!.address, list[0]!.family)
    })
  }
  return lookup as unknown as net.LookupFunction
}

type SingleResponse = { status: number; location: string | null; contentType: string; body: Buffer }

function decoderFor(encoding: string): NodeJS.ReadWriteStream | null {
  if (encoding === 'gzip' || encoding === 'x-gzip') return zlib.createGunzip()
  if (encoding === 'deflate') return zlib.createInflate()
  if (encoding === 'br') return zlib.createBrotliDecompress()
  return null
}

/** Rejects anything that must never be requested, before a socket is opened. */
function preflight(url: URL, isAllowed: (ip: string) => boolean): GuardedFetchError | null {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return new GuardedFetchError('Only http and https URLs are supported')
  }
  if (url.username || url.password) return new GuardedFetchError('URLs with credentials are not supported')

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (BLOCKED_HOSTNAMES.has(host)) return new GuardedFetchError('Host is not eligible')
  // A literal IP never reaches `lookup`, so it is checked here instead.
  if (net.isIP(host) && !isAllowed(host)) return new GuardedFetchError('Host resolves to a private address')
  return null
}

function requestOnce(
  url: URL,
  options: GuardedFetchOptions,
  isAllowed: (ip: string) => boolean,
  lookup: net.LookupFunction,
): Promise<SingleResponse> {
  return new Promise((resolve, reject) => {
    const refused = preflight(url, isAllowed)
    if (refused) {
      reject(refused)
      return
    }

    let settled = false
    // Declared before use by `finish`, assigned once the request exists.
    let deadline: ReturnType<typeof setTimeout> | undefined
    const finish = (error: Error | null, value?: SingleResponse) => {
      if (settled) return
      settled = true
      if (deadline) clearTimeout(deadline)
      if (error) reject(error)
      else resolve(value as SingleResponse)
    }

    const client = url.protocol === 'https:' ? https : http
    const request = client.request(
      url,
      {
        method: options.method ?? 'GET',
        lookup,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: options.accept ?? '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          ...(options.jsonBody !== undefined
            ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(options.jsonBody)) }
            : {}),
        },
      },
      (response) => {
        const status = response.statusCode ?? 0
        const contentType = String(response.headers['content-type'] ?? '')
          .split(';')[0]!
          .trim()
          .toLowerCase()

        // Redirects and failures carry nothing the caller needs, so their bodies are not downloaded.
        if (REDIRECT_STATUSES.has(status) || status < 200 || status >= 300) {
          response.resume()
          const location = typeof response.headers.location === 'string' ? response.headers.location : null
          finish(null, { status, location, contentType, body: Buffer.alloc(0) })
          return
        }

        const decoder = decoderFor(String(response.headers['content-encoding'] ?? '').toLowerCase())
        const stream: NodeJS.ReadableStream = decoder ? response.pipe(decoder) : response

        const chunks: Buffer[] = []
        let received = 0
        stream.on('data', (chunk: Buffer) => {
          if (settled) return
          received += chunk.length
          if (received > options.maxBytes) {
            finish(new GuardedFetchError('Response too large'))
            response.destroy()
            request.destroy()
            return
          }
          chunks.push(chunk)
        })
        stream.on('end', () => finish(null, { status, location: null, contentType, body: Buffer.concat(chunks) }))
        stream.on('error', (error: Error) => finish(error))
        response.on('error', (error: Error) => finish(error))
      },
    )

    // A hard deadline for the whole exchange. Socket `timeout` alone is an idle timer, which a
    // server trickling one byte a second would never trip.
    deadline = setTimeout(() => {
      finish(new GuardedFetchError('Request timed out'))
      request.destroy()
    }, options.timeoutMs)

    request.on('error', (error: Error) => finish(error))
    request.end(options.jsonBody)
  })
}

export async function guardedFetch(rawUrl: string, options: GuardedFetchOptions): Promise<GuardedResponse> {
  const isAllowed = options.isAddressAllowed ?? ((ip: string) => !isPrivateOrReservedIp(ip))
  const lookup = createSafeLookup(isAllowed, options.resolve)

  let current: URL
  try {
    current = new URL(rawUrl)
  } catch {
    throw new GuardedFetchError('Malformed URL')
  }

  for (let hop = 0; ; hop += 1) {
    const response = await requestOnce(current, options, isAllowed, lookup)

    // A POST is never re-sent to a redirect target: forwarding a body to wherever a server points
    // is how a notification ends up somewhere it was never meant to go.
    if (REDIRECT_STATUSES.has(response.status) && options.method !== 'POST') {
      if (!response.location) throw new GuardedFetchError('Redirect with no location')
      if (hop >= options.maxRedirects) throw new GuardedFetchError('Too many redirects')
      // Every hop is a fresh request through the same guarded path — a redirect to an internal
      // host fails exactly as the original URL would have.
      current = new URL(response.location, current)
      continue
    }

    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      finalUrl: current.toString(),
      contentType: response.contentType,
      body: response.body,
    }
  }
}
