'use client'

import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

type GlassPanelProps = {
  title: string
  children: ReactNode
  className?: string
  glow?: 'cyan' | 'green' | 'coral' | 'none'
}

const glowClass: Record<NonNullable<GlassPanelProps['glow']>, string> = {
  cyan: 'shadow-glow-cyan',
  green: 'shadow-glow-green',
  coral: 'shadow-glow-coral',
  none: 'shadow-glass-inset',
}

/** Shared chrome for every bottom-dashboard panel: glass fill, border, entrance animation. */
export function GlassPanel({ title, children, className = '', glow = 'none' }: GlassPanelProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={`flex h-full flex-col rounded-2xl border border-glass-border bg-glass backdrop-blur-hud ${glowClass[glow]} ${className}`}
    >
      <h2 className="border-b border-glass-border px-4 py-2.5 font-display text-xs font-semibold uppercase tracking-wider text-white/70">
        {title}
      </h2>
      <div className="flex-1 overflow-hidden p-4">{children}</div>
    </motion.section>
  )
}
