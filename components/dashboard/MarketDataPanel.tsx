'use client'

import { formatCents } from '@/lib/pricing/takeoverPricing'
import type { MarketSnapshot } from '@/types/game'
import { GlassPanel } from './GlassPanel'

type MarketDataPanelProps = {
  snapshot: MarketSnapshot
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

export function MarketDataPanel({ snapshot }: MarketDataPanelProps) {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Global Market Cap', value: formatCents(snapshot.globalMarketCapCents) },
    { label: 'Total Takeover Events', value: snapshot.totalTakeoverEvents.toLocaleString() },
    { label: 'Avg Revenue / Takeover', value: formatCents(snapshot.avgRevenuePerTakeoverCents) },
    { label: 'Avg Control Duration', value: formatDuration(snapshot.avgControlDurationSeconds) },
  ]

  return (
    <GlassPanel title="Live Market Data & Analytics" glow="cyan">
      <div className="flex h-full flex-col justify-center gap-2.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between text-xs">
            <span className="text-white/50">{row.label}</span>
            <span className="font-mono font-semibold tabular-nums text-white/90">{row.value}</span>
          </div>
        ))}
      </div>
    </GlassPanel>
  )
}
