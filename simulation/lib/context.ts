import type { RunConfig, SpeedPreset } from './args'
import type { SimHttp } from './http'
import type { SimLedger } from './ledger'
import type { SimLogger } from './logger'
import type { Metrics } from './metrics'
import type { Rng } from './rng'

/** One simulated company, driven by a real URL from ../advertisers.ts. */
export type Advertiser = {
  index: number
  url: string
  /** The hostname — the identity the app derives from the URL, and so the empire id. */
  domain: string
  ip: string
  color: string
  budgetCents: number
  spentCents: number
  joined: boolean
  blocked: boolean
  joinAttempts: number
  purchases: number
  takeovers: number
  /** Checkout times in the last minute, so a simulated person never buys faster than a real one. */
  recentCheckouts: number[]
}

export type ProbeOutcome = 'stopped' | 'not-stopped' | 'finding' | 'skipped'
export type ProbeRecord = { id: string; title: string; outcome: ProbeOutcome; note: string }

export type SimStats = {
  actions: Map<string, number>
  races: number
  refusedAsExpected: number
  paidNotDelivered: number
  visitorsOnline: number
  visitorsPeak: number
  probes: ProbeRecord[]
  findings: string[]
}

export type SimContext = {
  readonly config: RunConfig
  /** Changes live with the 1-4 keys. */
  speed: SpeedPreset
  readonly http: SimHttp
  readonly log: SimLogger
  readonly metrics: Metrics
  readonly ledger: SimLedger
  readonly rng: Rng
  /** Null when attached to someone else's server without its secret: payment webhooks are skipped. */
  readonly webhookSecret: string | null
  readonly advertisers: Advertiser[]
  readonly stats: SimStats
  /** Address the simulator uses for its own checks, separate from every simulated person. */
  readonly observerIp: string
  paused: boolean
  stopRequested: boolean
  baselineRevenueCents: number
}

export function makeAdvertiser(args: { index: number; url: string; ip: string; color: string; budgetCents: number }): Advertiser {
  return {
    ...args,
    domain: new URL(args.url).hostname,
    spentCents: 0,
    joined: false,
    blocked: false,
    joinAttempts: 0,
    purchases: 0,
    takeovers: 0,
    recentCheckouts: [],
  }
}

export function createStats(): SimStats {
  return {
    actions: new Map(),
    races: 0,
    refusedAsExpected: 0,
    paidNotDelivered: 0,
    visitorsOnline: 0,
    visitorsPeak: 0,
    probes: [],
    findings: [],
  }
}

export function countAction(ctx: SimContext, kind: string): void {
  ctx.stats.actions.set(kind, (ctx.stats.actions.get(kind) ?? 0) + 1)
}
