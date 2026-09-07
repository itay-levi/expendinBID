'use client'

import { useEffect, useState } from 'react'

type CountdownTimerProps = {
  endsAt: string // ISO timestamp
}

function splitDuration(ms: number) {
  const clamped = Math.max(ms, 0)
  const totalSeconds = Math.floor(clamped / 1000)
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
  }
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

export function CountdownTimer({ endsAt }: CountdownTimerProps) {
  // Deliberately NOT seeded from Date.now() during render. The server renders this component
  // once, the client re-renders it at hydration a few seconds later, and any clock-derived
  // initial value differs between the two — which React reports as a hydration mismatch and
  // which crashed the page ("Server: 50, Client: 59"). Starting at null means server HTML and
  // the first client render agree exactly; the live value only appears after mount.
  const [remainingMs, setRemainingMs] = useState<number | null>(null)

  useEffect(() => {
    const tick = () => setRemainingMs(new Date(endsAt).getTime() - Date.now())
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [endsAt])

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-glass-border bg-white/5 px-3 py-1.5">
      <span className="font-body text-[10px] uppercase tracking-wider text-white/50">War Ends In</span>
      <span className="font-mono text-sm font-semibold tabular-nums text-hexwars-cyan">
        {remainingMs === null ? '—' : formatCountdown(remainingMs)}
      </span>
    </div>
  )
}

export function formatCountdown(remainingMs: number): string {
  const { days, hours, minutes, seconds } = splitDuration(remainingMs)
  return `${days}D ${pad(hours)}H ${pad(minutes)}M ${pad(seconds)}S`
}
