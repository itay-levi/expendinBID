'use client'

import { useCallback, useState } from 'react'
import { HexGridCanvas } from '@/components/hexgrid/HexGridCanvas'
import { TopHUD } from '@/components/hud/TopHUD'
import { MapModeIndicator } from '@/components/hud/MapModeIndicator'
import { BottomDashboard } from '@/components/dashboard/BottomDashboard'
import { useGameStore } from '@/lib/state/gameStore'
import { useMapSync } from '@/lib/state/useMapSync'
import { formatCents } from '@/lib/pricing/takeoverPricing'
import type { HallOfFameEntry } from '@/components/dashboard/HallOfFamePanel'

// Fictional company names, deliberately — see ARCHITECTURE.md §14 on why real brand names aren't
// baked into demo data even as placeholders.
const DEMO_TICKER = ['ORBITCACHE acquired Hex #214', 'LATTICE disputed Hex #198', 'PIXELDECK secured Alpha Cluster']

const DEMO_HALL_OF_FAME: HallOfFameEntry[] = [
  {
    rank: 1,
    companyName: 'LATTICE',
    logoUrl: '',
    url: 'https://lattice.dev',
    peakValuationCents: 1_245_000,
    controlDurationLabel: '1h 15m',
    totalHexRevenueCents: 1_842_000,
  },
  {
    rank: 2,
    companyName: 'ORBITCACHE',
    logoUrl: '',
    url: 'https://orbitcache.io',
    peakValuationCents: 550_000,
    controlDurationLabel: '1h 05m',
    totalHexRevenueCents: 120_000,
  },
]

// A FIXED timestamp, not Date.now()-relative. A module-scope clock read is evaluated separately on
// the server and in the browser bundle, so the two disagree and React reports a hydration mismatch.
const DEMO_WAR_ENDS_AT = '2026-09-30T18:00:00.000Z'

export default function HexWarsPage() {
  const market = useGameStore((state) => state.market)
  const setMyEmpireId = useGameStore((state) => state.setMyEmpireId)
  const clearSelection = useGameStore((state) => state.clearSelection)
  const [notice, setNotice] = useState<string | null>(null)

  // Map state comes from the database, not from a client-side seed — so every visitor sees the
  // same world, and it survives a reload.
  useMapSync()

  const handleConquer = useCallback(
    async (input: { hexIds: string[]; url: string; protect: boolean; agreedToTerms: true }) => {
      // The server computes the price from current hex state and creates the checkout session —
      // this call never sends an amount. Ownership changes only from the verified webhook, except
      // in demo mode (no payment provider configured), which the server applies directly.
      const response = await fetch('/api/checkout/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })

      const body = await response.json().catch(() => null)

      if (!response.ok || !body?.success) {
        throw new Error(body?.error ?? 'Could not start checkout')
      }

      // Optimistic identity for the adjacency preview (ARCHITECTURE.md §23), matching the server's
      // own hostname-based id scheme. The server never trusts this value.
      setMyEmpireId(new URL(input.url).hostname)

      if (body.code === 'demo_applied') {
        // Already written to the database; the next map poll brings it back as real territory.
        clearSelection()
        setNotice(
          `Demo mode — ${input.hexIds.length} hex(es) claimed for ${formatCents(body.data.amountCents)}. No payment was taken.`,
        )
        return
      }

      window.location.href = body.data.checkoutUrl
    },
    [setMyEmpireId, clearSelection],
  )

  return (
    <main className="relative h-[100svh] w-screen overflow-hidden bg-hexwars-bg">
      <HexGridCanvas />

      <TopHUD
        totalWarRevenueCents={market.totalWarRevenueCents}
        activeConflicts={market.activeConflicts}
        tickerMessages={DEMO_TICKER}
        warEndsAt={DEMO_WAR_ENDS_AT}
      />

      <MapModeIndicator />

      {notice && (
        <div
          role="status"
          className="pointer-events-auto fixed left-1/2 top-24 z-30 max-w-[92vw] -translate-x-1/2 rounded-xl border border-hexwars-cyan/40 bg-glass px-4 py-2 text-xs text-hexwars-cyan shadow-glow-cyan backdrop-blur-hud md:top-16"
        >
          {notice}
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            className="ml-3 text-white/40 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      <BottomDashboard hallOfFameEntries={DEMO_HALL_OF_FAME} onConquer={handleConquer} />
    </main>
  )
}
