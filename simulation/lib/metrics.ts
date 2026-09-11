export type MetricRow = {
  endpoint: string
  count: number
  p50: number
  p95: number
  max: number
  /** 4xx — often expected (refusals, attacks), so counted but not treated as failures. */
  clientErrors: number
  serverErrors: number
  networkErrors: number
}

type Series = { durations: number[]; clientErrors: number; serverErrors: number; networkErrors: number }

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index] ?? 0
}

/** Response times and failures per endpoint, for the performance table. */
export class Metrics {
  private readonly series = new Map<string, Series>()

  record(endpoint: string, ms: number, status: number): void {
    const entry = this.series.get(endpoint) ?? { durations: [], clientErrors: 0, serverErrors: 0, networkErrors: 0 }
    entry.durations.push(ms)
    if (status === 0) entry.networkErrors += 1
    else if (status >= 500) entry.serverErrors += 1
    else if (status >= 400) entry.clientErrors += 1
    this.series.set(endpoint, entry)
  }

  row(endpoint: string): MetricRow | null {
    const entry = this.series.get(endpoint)
    if (!entry) return null
    const sorted = [...entry.durations].sort((a, b) => a - b)
    return {
      endpoint,
      count: sorted.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      max: sorted[sorted.length - 1] ?? 0,
      clientErrors: entry.clientErrors,
      serverErrors: entry.serverErrors,
      networkErrors: entry.networkErrors,
    }
  }

  rows(): MetricRow[] {
    return [...this.series.keys()]
      .map((endpoint) => this.row(endpoint))
      .filter((row): row is MetricRow => row !== null)
      .sort((a, b) => b.count - a.count)
  }

  total5xx(): number {
    return this.rows().reduce((sum, row) => sum + row.serverErrors, 0)
  }

  totalNetworkErrors(): number {
    return this.rows().reduce((sum, row) => sum + row.networkErrors, 0)
  }
}
