'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Volume2, VolumeX } from 'lucide-react'
import { RevenueCounter } from './RevenueCounter'
import { LiveTicker } from './LiveTicker'
import { CountdownTimer } from './CountdownTimer'
import { LiveVisitorsWidget } from './LiveVisitorsWidget'
import { FooterNav } from '@/components/layout/FooterNav'
import { soundEngine } from '@/lib/audio/soundEngine'
import { useBattleSounds } from '@/lib/audio/useBattleSounds'

type TopHUDProps = {
  totalWarRevenueCents: number
  activeConflicts: number
  tickerMessages: string[]
  warEndsAt: string
}

/**
 * The status bar. Two rows on a phone, one from `md` up.
 *
 * The Hall of Fame and Global Feed buttons that used to live here are gone: they duplicated the
 * tab strip above the claim bar, and on a phone the row of five labelled buttons overflowed the
 * viewport width and pushed the ticker off screen entirely.
 */
export function TopHUD({ totalWarRevenueCents, activeConflicts, tickerMessages, warEndsAt }: TopHUDProps) {
  const [soundEnabled, setSoundEnabled] = useState(false)
  useBattleSounds(soundEnabled)

  const toggleSound = () => {
    const next = !soundEnabled
    // Browsers only allow audio to start inside a user gesture, so the engine is created on the
    // first click rather than on mount.
    if (next) void soundEngine.init().then(() => soundEngine.setMuted(false))
    else soundEngine.setMuted(true)
    setSoundEnabled(next)
  }

  return (
    <motion.header
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="pointer-events-none fixed inset-x-0 top-0 z-20 border-b border-glass-border bg-glass backdrop-blur-hud"
    >
      <div className="flex items-center gap-3 px-3 py-2 md:gap-5 md:px-6 md:py-2.5">
        <span className="pointer-events-auto flex-none font-display text-xs font-bold tracking-wide text-white md:text-sm">
          HEX WARS<span className="text-hexwars-cyan">:</span>
          {/* The tagline is the first thing to go when width is scarce — the name carries it. */}
          <span className="hidden sm:inline"> LIVE AD TAKEOVER</span>
        </span>

        <div className="hidden h-6 w-px flex-none bg-glass-border md:block" />

        <div className="pointer-events-auto flex min-w-0 flex-none items-center gap-3 md:gap-5">
          <RevenueCounter totalCents={totalWarRevenueCents} />
          <div className="hidden items-center gap-1.5 lg:flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-hexwars-coral" />
            <span className="font-mono text-xs font-semibold text-hexwars-coral">
              {activeConflicts} ACTIVE CONFLICTS
            </span>
          </div>
          <div className="hidden lg:block">
            <LiveVisitorsWidget />
          </div>
        </div>

        {/* Ticker only where there's room for it to read as a ticker rather than a stutter. */}
        <div className="hidden min-w-0 flex-1 md:block">
          <LiveTicker messages={tickerMessages} />
        </div>

        <div className="pointer-events-auto ml-auto flex flex-none items-center gap-2 md:gap-3">
          <CountdownTimer endsAt={warEndsAt} />

          <button
            type="button"
            onClick={toggleSound}
            aria-label={soundEnabled ? 'Mute battle sounds' : 'Unmute battle sounds'}
            aria-pressed={soundEnabled}
            className="flex items-center gap-1.5 rounded-lg border border-glass-border px-2.5 py-1.5 text-xs font-medium text-white/70 transition-colors hover:border-hexwars-cyan hover:text-hexwars-cyan"
          >
            {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
            <span className="hidden lg:inline">Horn of Battle</span>
          </button>

          <div className="hidden h-6 w-px bg-glass-border md:block" />
          <FooterNav />
        </div>
      </div>

      {/* Second row on phones only, so the ticker still has somewhere to live. */}
      <div className="pointer-events-auto border-t border-glass-border/60 px-3 py-1.5 md:hidden">
        <LiveTicker messages={tickerMessages} />
      </div>
    </motion.header>
  )
}
