'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, useAnimationControls } from 'framer-motion'
import { formatCents } from '@/lib/pricing/takeoverPricing'

type RevenueCounterProps = {
  totalCents: number
}

/** Pulses green on every increase; the previous value is tracked to detect deltas, not just re-renders. */
export function RevenueCounter({ totalCents }: RevenueCounterProps) {
  const controls = useAnimationControls()
  const previousRef = useRef(totalCents)
  const [justIncreased, setJustIncreased] = useState(false)

  useEffect(() => {
    if (totalCents > previousRef.current) {
      setJustIncreased(true)
      controls.start({
        scale: [1, 1.08, 1],
        transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
      })
      const timeout = setTimeout(() => setJustIncreased(false), 600)
      previousRef.current = totalCents
      return () => clearTimeout(timeout)
    }
    previousRef.current = totalCents
  }, [totalCents, controls])

  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-body text-[11px] uppercase tracking-wider text-white/50">
        Total War Revenue
      </span>
      <motion.span
        animate={controls}
        className={`font-mono text-sm font-bold tabular-nums transition-colors ${
          justIncreased ? 'text-hexwars-green' : 'text-white/90'
        }`}
      >
        {formatCents(totalCents)}
      </motion.span>
    </div>
  )
}
