'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useLiveVisitors } from '@/lib/analytics/useLiveVisitors'

/** Renders "—" whenever DataFast isn't configured or hasn't answered yet — never a placeholder number. */
export function LiveVisitorsWidget() {
  const activeVisitors = useLiveVisitors()

  return (
    <div className="hidden items-center gap-2 md:flex" title="Live visitors, via DataFast">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-hexwars-green opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-hexwars-green" />
      </span>
      <span className="font-body text-[10px] uppercase tracking-wider text-white/50">Live Visitors</span>
      <AnimatePresence mode="popLayout">
        <motion.span
          key={activeVisitors ?? 'unknown'}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.25 }}
          className="font-mono text-sm font-bold tabular-nums text-hexwars-green"
        >
          {activeVisitors === null ? '—' : activeVisitors.toLocaleString()}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}
