'use client'

import { formatCents } from '@/lib/pricing/takeoverPricing'
import { GlassPanel } from './GlassPanel'

export type HallOfFameEntry = {
  rank: number
  companyName: string
  logoUrl: string
  /** Full URL for the permanent outbound link — rendered with rel="sponsored" (see ARCHITECTURE.md §21). */
  url: string
  peakValuationCents: number
  controlDurationLabel: string
  totalHexRevenueCents: number
}

type HallOfFamePanelProps = {
  entries: HallOfFameEntry[]
}

export function HallOfFamePanel({ entries }: HallOfFamePanelProps) {
  return (
    <GlassPanel title="Hall of Fame (All-Time)" glow="none">
      <div className="h-full overflow-y-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="text-white/40">
              <th className="pb-2 font-medium">Rank</th>
              <th className="pb-2 font-medium">Company</th>
              <th className="pb-2 text-right font-medium">Peak Valuation</th>
              <th className="pb-2 text-right font-medium">Control</th>
              <th className="pb-2 text-right font-medium">Hex Revenue</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.rank} className="border-t border-glass-border/60">
                <td className="py-1.5 font-mono text-white/50">#{entry.rank}</td>
                <td className="py-1.5 font-medium text-white/90">
                  {/* Paid, guaranteed-duration outbound links are marked rel="sponsored" per
                      Google's paid-link guidance — a plain do-follow link here would be a link
                      scheme (selling PageRank), which risks a manual action against both this
                      site and every empire listed here. */}
                  <a href={entry.url} target="_blank" rel="noopener noreferrer sponsored" className="hover:text-hexwars-cyan">
                    {entry.companyName}
                  </a>
                </td>
                <td className="py-1.5 text-right font-mono tabular-nums text-white/70">
                  {formatCents(entry.peakValuationCents)}
                </td>
                <td className="py-1.5 text-right font-mono tabular-nums text-white/70">
                  {entry.controlDurationLabel}
                </td>
                <td className="py-1.5 text-right font-mono tabular-nums text-hexwars-green">
                  {formatCents(entry.totalHexRevenueCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassPanel>
  )
}
