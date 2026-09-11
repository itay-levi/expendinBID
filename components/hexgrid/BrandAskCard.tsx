'use client'

import { useEffect, useRef } from 'react'
import { Html } from '@react-three/drei'
import { X } from 'lucide-react'
import { brandAskAnchor } from '@/lib/state/brandAsk'
import { parseTargetUrl } from '@/lib/validation/targetUrlSchema'
import { coordFromHexId } from '@/lib/hex/hexIdentity'
import { axialToPixel } from '@/lib/hex/hexMath'
import { HEX_SIZE } from '@/lib/hex/mapConfig'
import { useGameStore } from '@/lib/state/gameStore'

/** Clear of the pending prism top (0.26) so the card floats above the tile it belongs to. */
const CARD_ELEVATION = 0.4

/**
 * "What's your website?", pinned to the first tile a buyer claims.
 *
 * Asked here rather than up front because a form on arrival spends the best moment of the product
 * before anyone has seen why they would fill it in. Clicking a tile is the fun part and it teaches
 * the map in seconds; the question arrives immediately after, attached to the very space being
 * bought, so the answer has visible consequences.
 *
 * It fires at most once — see lib/state/brandAsk.ts for the timing rule, which is a pure function
 * precisely so "once" is a tested guarantee rather than a hope. Dismissing it is permanent for the
 * visit; the claim bar carries the same field from then on.
 *
 * This is the one overlay on the map that DOES take pointer events, because it contains an input.
 * That is affordable only because it appears once, right after a single deliberate click, when
 * nobody is mid-sweep across tiles — the condition that made the old hover card intolerable.
 */
export function BrandAskCard() {
  const ownedHexes = useGameStore((s) => s.ownedHexes)
  const selectedHexIds = useGameStore((s) => s.selectedHexIds)
  const pendingBrand = useGameStore((s) => s.pendingBrand)
  const brandAskDismissed = useGameStore((s) => s.brandAskDismissed)
  const claimUrlInput = useGameStore((s) => s.claimUrlInput)
  const setClaimUrlInput = useGameStore((s) => s.setClaimUrlInput)
  const dismissBrandAsk = useGameStore((s) => s.dismissBrandAsk)

  const anchorId = brandAskAnchor({
    ownedHexes,
    selectedHexIds,
    hasBrand: pendingBrand !== null,
    askDismissed: brandAskDismissed,
  })

  const inputRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // Focused on appearance so the buyer can simply type — but only when the card is genuinely the
  // thing on top. drei renders it inside the canvas's own stacking context, so a tile under the HUD
  // or the claim bar puts the card BEHIND them; focusing it there sent the buyer's keystrokes into
  // an input they could not see. Measured after drei has positioned it, two frames in.
  useEffect(() => {
    if (!anchorId) return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const card = cardRef.current
        if (!card) return
        const rect = card.getBoundingClientRect()
        const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        if (topmost && card.contains(topmost)) inputRef.current?.focus({ preventScroll: true })
      })
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [anchorId])

  if (!anchorId) return null

  const coord = coordFromHexId(anchorId)
  if (!coord) return null
  const { x, z } = axialToPixel(coord, HEX_SIZE)

  return (
    <Html
      position={[x, CARD_ELEVATION, z]}
      center
      zIndexRange={[45, 0]}
      // Wrapper stays inert; only the card itself is interactive, so the map around it keeps
      // taking clicks normally.
      style={{ pointerEvents: 'none' }}
    >
      <div
        ref={cardRef}
        // Lifted clear of the tile so it points at the space without covering it.
        style={{ transform: 'translateY(-110px)', pointerEvents: 'auto' }}
        className="relative w-64 rounded-xl border border-hexwars-cyan/60 bg-glass p-3 shadow-glow-cyan backdrop-blur-hud"
      >
        <button
          type="button"
          onClick={dismissBrandAsk}
          aria-label="Dismiss"
          className="absolute right-2 top-2 rounded p-0.5 text-white/35 transition-colors hover:text-white"
        >
          <X size={13} />
        </button>

        <div className="font-display text-[13px] font-bold leading-tight text-white">Your logo goes here</div>
        <p className="mt-0.5 text-[11px] leading-snug text-white/50">
          What&apos;s your website? We&apos;ll fetch the logo and description.
        </p>

        <form
          className="mt-2.5 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            // Only a real address answers the question. Dismissal is permanent, so closing on a
            // half-typed or invalid entry left the buyer with no prompt and nothing on the map.
            if (parseTargetUrl(claimUrlInput).success) dismissBrandAsk()
          }}
        >
          <label htmlFor="brand-ask-url" className="sr-only">
            Your website address
          </label>
          <input
            ref={inputRef}
            id="brand-ask-url"
            type="text"
            inputMode="url"
            autoComplete="url"
            value={claimUrlInput}
            onChange={(event) => setClaimUrlInput(event.target.value)}
            placeholder="yourcompany.com"
            // 16px on mobile: anything smaller makes iOS Safari zoom the whole page on focus.
            className="min-w-0 flex-1 rounded-lg border border-glass-border bg-white/5 px-2.5 py-1.5 text-base text-white outline-none placeholder:text-white/30 focus:border-hexwars-cyan sm:text-[13px]"
          />
          <button
            type="submit"
            className="flex-none rounded-lg bg-hexwars-cyan px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-wide text-hexwars-bg"
          >
            Go
          </button>
        </form>

        {/* Little tail pointing down at the tile this is about. */}
        <span
          aria-hidden
          className="absolute -bottom-[7px] left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-hexwars-cyan/60 bg-glass"
        />
      </div>
    </Html>
  )
}
