import type { AxialCoord } from '@/lib/hex/hexMath'

export type HexTile = {
  id: string
  coord: AxialCoord
  ownerId: string | null
  isCapital: boolean
  lastPricePaidCents: number
  isContested: boolean
  ownedSince: string | null
  /** Set by the "Protect Hex" upsell — null/past means unlocked. Blocks takeover execution only; see ARCHITECTURE.md §17. */
  lockedUntil: string | null
}

export type Empire = {
  id: string
  domain: string
  name: string
  /** Full submitted URL (https://…) — required for click-to-visit navigation and outbound links. */
  url: string
  logoUrl: string
  primaryColorHex: string
  /** Scraped og:title / <title>, resolved server-side once at capital-purchase time. */
  ogTitle: string
  /** Scraped og:description / meta description, resolved server-side once at capital-purchase time. */
  ogDescription: string
  capitalHexId: string
  foundedAt: string
  /**
   * Opt-in only — the buyer supplies their own webhook URL if they want a takeover notification.
   * Never derived from scraping or guessing an address; see ARCHITECTURE.md §18 on why.
   */
  notifyWebhookUrl: string | null
}

export type TakeoverEvent = {
  id: string
  hexId: string
  attackerEmpireId: string
  defenderEmpireId: string | null
  pricePaidCents: number
  createdAt: string
}

export type MarketSnapshot = {
  totalWarRevenueCents: number
  activeConflicts: number
  globalMarketCapCents: number
  totalTakeoverEvents: number
  avgRevenuePerTakeoverCents: number
  avgControlDurationSeconds: number
}

export type SelectionState = {
  hoveredHexId: string | null
  selectedHexId: string | null
}
