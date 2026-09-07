'use client'

import { Swords, ExternalLink, Lock, Check } from 'lucide-react'
import { logoProxyUrl } from '@/lib/brand/logoProxyUrl'
import { keepHover, releaseHover } from '@/lib/state/hoverIntent'
import { formatCents, requiredPriceForHex } from '@/lib/pricing/takeoverPricing'
import { ELIGIBILITY_MESSAGES, type EligibilityResult } from '@/lib/hex/territoryEligibility'
import type { MapMode } from '@/lib/state/gameStore'
import type { Empire, HexTile } from '@/types/game'

export const CONQUEST_CARD_DOM_ID = 'hex-conquest-card'

type ConquestCardProps = {
  hex: HexTile
  owner: Empire | null
  /** null = DataFast not configured or not yet answered — render as sample data, never a real-looking fake number. */
  liveVisitors: number | null
  /** Civilization-style adjacency rule (ARCHITECTURE.md §23) — a preview only; the server enforces it independently. */
  eligibility: EligibilityResult
  /** Already in the buyer's basket. */
  isSelected: boolean
  /** What a click will do right now — the card must promise the same thing the map does. */
  mapMode: MapMode
}

/**
 * The "Conquest Card": hovering (or right-click, for touch/no-hover devices — wired at the call
 * site) reveals this instead of immediately navigating, so a visitor can see valuation and scraped
 * metadata before either attacking or visiting the owner's actual site (plain click on the hex
 * itself does the latter — see EmptyHexField/BrandHexTile's click handlers).
 *
 * This is the card's contents only. Its drei <Html> host is owned by ConquestCardLayer and stays
 * mounted across hovers on purpose — see the comment there.
 */
export function ConquestCard({ hex, owner, liveVisitors, eligibility, isSelected, mapMode }: ConquestCardProps) {
  const cost = requiredPriceForHex(hex)
  const isOwn = hex.ownerId === 'player' // demo convenience id; real app compares against the signed-in empire's id
  const isBlocked = !isOwn && !eligibility.eligible
  const logoSrc = logoProxyUrl(owner?.logoUrl)

  return (
    <div
      id={CONQUEST_CARD_DOM_ID}
      // Lifted clear of the hex (and the cursor) so the tile underneath stays clickable, and
      // re-enabled for pointer events here so the Conquer button still works.
      style={{ transform: 'translateY(-72px)', pointerEvents: 'auto' }}
      // The pointer made it across the gap — cancel the pending close so the button can be
      // clicked. releaseHover on the way out restarts the same grace timer rather than closing
      // instantly, so brushing the card's edge doesn't dismiss it. See lib/state/hoverIntent.ts.
      onPointerEnter={keepHover}
      onPointerLeave={releaseHover}
      className={`w-64 rounded-xl border border-glass-border bg-glass p-3 text-xs font-body text-white/90 backdrop-blur-hud ${
        isBlocked ? 'shadow-glow-coral' : 'shadow-glow-cyan'
      }`}
    >
      {owner ? (
        <div className="flex items-start gap-2.5">
          {/*
            The scraped brand mark, at a real size and on a light chip. Company logos are drawn for
            light backgrounds, so rendering one straight onto the dark glass hides half of them.
            Routed through the same-origin proxy as the map plaque, and `onError` collapses the
            element entirely rather than leaving a broken-image glyph on the card.
          */}
          {logoSrc && (
            <img
              src={logoSrc}
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 flex-none rounded-lg bg-white object-contain p-1 ring-1 ring-white/15"
              onError={(event) => {
                event.currentTarget.style.display = 'none'
              }}
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[11px] font-semibold text-hexwars-cyan">{owner.domain}</div>
            <div className="mt-0.5 line-clamp-2 font-display text-[13px] font-bold leading-tight text-white">
              {owner.ogTitle}
            </div>
          </div>
        </div>
      ) : (
        <div className="font-display text-[13px] font-bold leading-tight text-white">Unclaimed territory</div>
      )}

      {owner?.ogDescription && (
        <p className="mt-1.5 line-clamp-3 text-[11px] leading-snug text-white/55">{owner.ogDescription}</p>
      )}

      <div className="mt-2.5 space-y-1 border-t border-glass-border pt-2">
        {owner ? (
          <div className="flex justify-between gap-4">
            <span className="text-white/50">Last paid</span>
            <span className="font-mono text-white/70">{formatCents(hex.lastPricePaidCents)}</span>
          </div>
        ) : (
          <div className="flex justify-between gap-4">
            <span className="text-white/50">Status</span>
            <span className="font-mono font-medium text-white/70">Unclaimed</span>
          </div>
        )}
        {liveVisitors !== null && (
          <div className="flex justify-between gap-4">
            <span className="text-white/50">Live viewers</span>
            <span className="font-mono font-medium text-hexwars-green">{liveVisitors.toLocaleString()}</span>
          </div>
        )}
      </div>

      {isOwn ? (
        <div className="mt-2.5 text-center font-display text-[10px] font-semibold uppercase tracking-wide text-white/40">
          Your territory
        </div>
      ) : owner && mapMode === 'browse' ? (
        // Browsing: the click belongs to the advertiser, and the card says so rather than
        // advertising a purchase the click will not make.
        <div className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg border border-hexwars-cyan/40 bg-hexwars-cyan/10 py-2 text-center font-display text-[11px] font-bold uppercase tracking-wide text-hexwars-cyan">
          <ExternalLink size={12} />
          Click to visit {owner.domain}
        </div>
      ) : isBlocked ? (
        <div className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg border border-hexwars-coral/30 bg-hexwars-coral/10 py-2 text-center font-display text-[10px] font-semibold uppercase tracking-wide text-hexwars-coral">
          <Lock size={11} />
          {ELIGIBILITY_MESSAGES[eligibility.reason]}
        </div>
      ) : isSelected ? (
        <div className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg border border-hexwars-green/40 bg-hexwars-green/15 py-2 text-center font-display text-[10px] font-semibold uppercase tracking-wide text-hexwars-green">
          <Check size={11} />
          Selected — click again to remove
        </div>
      ) : (
        <div className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg bg-hexwars-green py-2 text-center font-display text-[11px] font-bold uppercase tracking-wide text-hexwars-bg">
          <Swords size={12} />
          Click to {owner ? 'take over' : 'claim'} · {formatCents(cost)}
        </div>
      )}

      {/* The escape hatch, only worth mentioning when the plain click does something else. */}
      {owner && mapMode === 'conquer' && (
        <div className="mt-1.5 flex items-center justify-center gap-1 text-[10px] text-white/35">
          <ExternalLink size={10} />
          Shift-click to visit instead
        </div>
      )}
    </div>
  )
}
