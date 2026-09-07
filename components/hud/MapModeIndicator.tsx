'use client'

import { useEffect } from 'react'
import { Swords, Link2, X } from 'lucide-react'
import { useGameStore } from '@/lib/state/gameStore'

/**
 * Says out loud which mode the map is in, and tints the screen while conquering.
 *
 * Deliberately loud, because being in the wrong mode is expensive in both directions: a stray
 * click in browse mode navigates you off the site entirely, and a stray click in conquer mode adds
 * a tile to a basket you are about to pay for. A quiet indicator would be fine if the cost of
 * confusion were low; here it isn't.
 *
 * The cursor is driven from a `data-map-mode` attribute on `<body>` (see globals.css) rather than
 * from a React prop on the canvas — the canvas belongs to R3F, and re-rendering the whole scene to
 * change a CSS cursor would be an absurd price for it. It also gives touch devices, which have no
 * cursor at all, the same pill and tint everyone else gets.
 */
export function MapModeIndicator() {
  const mapMode = useGameStore((state) => state.mapMode)
  const setMapMode = useGameStore((state) => state.setMapMode)
  const selectedCount = useGameStore((state) => state.selectedHexIds.length)

  useEffect(() => {
    document.body.dataset.mapMode = mapMode
    return () => {
      delete document.body.dataset.mapMode
    }
  }, [mapMode])

  const isConquering = mapMode === 'conquer'

  return (
    <>
      {/* Edge vignette, purely decorative and never interactive. */}
      {isConquering && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-10 shadow-[inset_0_0_120px_rgba(255,51,102,0.28)]"
        />
      )}

      <div className="pointer-events-none fixed inset-x-0 top-20 z-20 flex justify-center md:top-16">
        <button
          type="button"
          onClick={() => setMapMode(isConquering ? 'browse' : 'conquer')}
          // A live region: on a phone there is no cursor to signal the change, so the mode has to
          // announce itself to assistive tech when it flips on its own.
          aria-live="polite"
          className={`pointer-events-auto flex items-center gap-2 rounded-full border px-3.5 py-1.5 font-display text-[11px] font-bold uppercase tracking-wide backdrop-blur-hud transition-colors ${
            isConquering
              ? 'border-hexwars-coral/50 bg-hexwars-coral/15 text-hexwars-coral shadow-glow-coral'
              : 'border-glass-border bg-glass text-white/55 hover:text-hexwars-cyan'
          }`}
        >
          {isConquering ? <Swords size={13} /> : <Link2 size={13} />}
          {isConquering ? 'Conquering' : 'Browsing'}
          <span className="font-body text-[10px] font-normal normal-case tracking-normal opacity-70">
            {isConquering ? '· tap tiles to claim' : '· tap a logo to visit'}
          </span>
          {isConquering && (
            <>
              {selectedCount > 0 && (
                <span className="rounded-full bg-hexwars-coral/25 px-1.5 py-0.5 font-mono text-[10px]">
                  {selectedCount}
                </span>
              )}
              <X size={13} className="opacity-70" />
            </>
          )}
        </button>
      </div>
    </>
  )
}
