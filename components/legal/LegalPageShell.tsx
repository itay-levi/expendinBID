import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'

type LegalPageShellProps = {
  title: string
  lastUpdated: string
  children: ReactNode
}

/**
 * Shared chrome for /terms and /privacy: unlike the game canvas (a fixed-viewport 3D scene),
 * these are normal scrollable document pages, styled in the same dark-glass language.
 */
export function LegalPageShell({ title, lastUpdated, children }: LegalPageShellProps) {
  return (
    <div className="min-h-screen w-full bg-hexwars-bg px-4 py-10 md:px-8 md:py-16">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg border border-glass-border px-3 py-1.5 text-xs font-medium text-white/60 shadow-glass-inset transition-colors hover:border-hexwars-cyan hover:text-hexwars-cyan hover:shadow-glow-cyan"
        >
          <ArrowLeft size={14} />
          Back to Game Canvas
        </Link>

        <div className="mt-6 rounded-2xl border border-glass-border bg-glass p-6 shadow-glass-inset backdrop-blur-hud md:p-10">
          <h1 className="font-display text-2xl font-bold text-white md:text-3xl">{title}</h1>
          <p className="mt-1.5 text-xs uppercase tracking-wide text-white/40">Last updated: {lastUpdated}</p>

          <div className="prose prose-invert mt-8 max-w-none prose-headings:font-display prose-headings:font-bold prose-h2:mt-10 prose-h2:text-lg prose-h2:text-hexwars-cyan prose-h3:text-white prose-p:text-white/70 prose-li:text-white/70 prose-strong:text-white prose-a:text-hexwars-cyan">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
