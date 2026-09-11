import type { Metrics } from './metrics'

export type SimRequest = {
  method: 'GET' | 'POST'
  path: string
  /** Label for the performance table, e.g. "GET /api/map". */
  endpoint: string
  /**
   * The simulated person's address. The app sits behind a proxy in production and reads the client
   * address from X-Forwarded-For, so each simulated person gets their own — which is also what
   * keeps one person's rate limit from being shared by everybody.
   */
  ip: string
  body?: unknown
  rawBody?: string
  headers?: Record<string, string>
  timeoutMs?: number
}

export type SimResponse<T> = {
  status: number
  ms: number
  json: T | null
  text: string
  /** Set when there was no HTTP response at all; status is then 0. */
  networkError: string | null
}

/** Every request the simulator makes goes through here, so every one is timed and counted. */
export class SimHttp {
  constructor(
    readonly baseUrl: string,
    private readonly metrics: Metrics,
  ) {}

  async send<T>(request: SimRequest): Promise<SimResponse<T>> {
    const headers: Record<string, string> = { 'x-forwarded-for': request.ip, ...(request.headers ?? {}) }
    let body: string | undefined
    if (request.rawBody !== undefined) {
      body = request.rawBody
    } else if (request.body !== undefined) {
      body = JSON.stringify(request.body)
      if (!headers['content-type']) headers['content-type'] = 'application/json'
    }

    const started = performance.now()
    try {
      const response = await fetch(`${this.baseUrl}${request.path}`, {
        method: request.method,
        headers,
        body,
        signal: AbortSignal.timeout(request.timeoutMs ?? 60_000),
      })
      const text = await response.text()
      const ms = performance.now() - started
      this.metrics.record(request.endpoint, ms, response.status)
      let json: T | null = null
      try {
        json = text ? (JSON.parse(text) as T) : null
      } catch {
        json = null
      }
      return { status: response.status, ms, json, text: text.length > 4_000 ? `${text.slice(0, 4_000)}...` : text, networkError: null }
    } catch (error: unknown) {
      const ms = performance.now() - started
      this.metrics.record(request.endpoint, ms, 0)
      return { status: 0, ms, json: null, text: '', networkError: error instanceof Error ? error.message : String(error) }
    }
  }
}
