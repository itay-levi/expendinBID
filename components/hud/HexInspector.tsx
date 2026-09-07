'use client'

import { useMemo } from 'react'
import { ExternalLink, Lock, Check, Swords } from 'lucide-react'
import { axialKey } from '@/lib/hex/hexMath'
import { coordFromHexId } from '@/lib/hex/hexIdentity'
import { checkSelectionEligibility } from '@/lib/hex/selectionEligibility'
import { ELIGIBILITY_MESSAGES } from '@/lib/hex/territoryEligibility'
import { logoProxyUrl } from '@/lib/brand/logoProxyUrl'
import { formatCents, requiredPriceForHex } from '@/lib/pricing/takeoverPricing'
import { useGameStore, selectHexById, selectOwnerAt } from '@/lib/state/gameStore'

/**
 * Details of whatever tile the pointer is over, in a fixed panel at the edge of the screen.
 *
 * This replaces a card that floated on the map above the hovered hex. That card was in the way by
 * construction: the camera looks down at 60 degrees, so the space "above" a tile on screen is
 * occupied by other tiles, and a panel there covered the very hexes someone was trying to click
 * next. Even made click-through it still hid them.
 *
 * Anchoring it to a corner solves that outright — the panel never moves, never covers the tile you
 * are aiming at, and reading it never costs you your place on the map. It also stops the layout
 * thrashing as the pointer travels, which is what made selecting a run of tiles feel jumpy.
 */
export function HexInspector() {
  const hoveredHexId = useGameStore((s) => s.hoveredHexId)
  const ownedHexes = useGameStore((s) => s.ownedHexes)
  const empires = useGameStore((s) => s.empires)
  const selectedHexIds = useGameStore((s) => s.selectedHexIds)
  const myEmpireId = useGameStore((s) => s.myEmpireId)
  const mapMode = useGameStore((s) => s.mapMode)

  const hex = hoveredHexId ? selectHexById({ ownedHexes }, hoveredHexId) : null
  const owner = hex?.ownerId ? empires.get(hex.ownerId) ?? null : null

  const selectedKeys = useMemo(
    () =>
      new Set(
        selectedHexIds
          .map(coordFromHexId)
          .filter((coord): coord is NonNullable<typeof coord> => coord !== null)
          .map(axialKey),
      ),
    [selectedHexIds],
  )

  if (!hex) return null

  const isSelected = selectedHexIds.includes(hex.id)
  const eligibility = checkSelectionEligibility(
    hex.coord,
    (coord) => selectOwnerAt({ ownedHexes }, coord),
    myEmpireId,
    { selectedKeys },
  )
  const isBlocked = !eligibility.eligible
  const logoSrc = logoProxyUrl(owner?.logoUrl)

  return (
    // pointer-events-none throughout: this is a read-out, never a control. Everything it could
    // offer is already done by clicking the tile itself.
    <div className="pointer-events-none fixed left-3 top-24 z-20 w-64 max-w-[calc(100vw-1.5rem)] rounded-xl border border-glass-border bg-glass p-3 text-xs backdrop-blur-hud md:top-20">
      {owner ? (
        <div className="flex items-start gap-2.5">
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
        <p className="mt-1.5 line-clamp-4 text-[11px] leading-snug text-white/60">{owner.ogDescription}</p>
      )}

      <div className="mt-2.5 space-y-1 border-t border-glass-border pt-2">
        <div className="flex justify-between gap-4">
          <span className="text-white/50">{owner ? 'Owner paid' : 'Base price'}</span>
          <span className="font-mono text-white/70">{formatCents(hex.lastPricePaidCents)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-white/50">{owner ? 'Takeover from' : 'Yours from'}</span>
          <span className="font-mono font-semibold text-hexwars-green">{formatCents(requiredPriceForHex(hex))}</span>
        </div>
      </div>

      {owner && mapMode === 'browse' ? (
        <div className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg border border-hexwars-cyan/40 bg-hexwars-cyan/10 py-2 text-center font-display text-[10px] font-bold uppercase tracking-wide text-hexwars-cyan">
          <ExternalLink size={11} />
          Click to visit
        </div>
      ) : isBlocked ? (
        <div className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg border border-hexwars-coral/30 bg-hexwars-coral/10 py-2 text-center font-display text-[10px] font-semibold uppercase tracking-wide text-hexwars-coral">
          <Lock size={11} />
          {ELIGIBILITY_MESSAGES[eligibility.reason]}
        </div>
      ) : isSelected ? (
        <div className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg border border-hexwars-green/40 bg-hexwars-green/15 py-2 text-center font-display text-[10px] font-semibold uppercase tracking-wide text-hexwars-green">
          <Check size={11} />
          Selected
        </div>
      ) : (
        <div className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg bg-hexwars-green py-2 text-center font-display text-[10px] font-bold uppercase tracking-wide text-hexwars-bg">
          <Swords size={11} />
          Click to {owner ? 'take over' : 'claim'}
        </div>
      )}
    </div>
  )
}
