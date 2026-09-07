'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Swords, Loader2, AlertCircle, X, ShieldCheck } from 'lucide-react'
import { useBrandPreview } from '@/lib/brand/useBrandPreview'
import { logoProxyUrl } from '@/lib/brand/logoProxyUrl'
import { useGameStore } from '@/lib/state/gameStore'
import { formatCents } from '@/lib/pricing/takeoverPricing'

type ClaimBarProps = {
  selectedCount: number
  totalCents: number | null
  subtotalCents: number
  discountCents: number
  /** The next volume tier within reach, for the "N more tiles for X% off" nudge. */
  nextTier: { minHexes: number; rate: number } | null
  blockedReason: string | null
  protect: boolean
  onProtectChange: (protect: boolean) => void
  onClearSelection: () => void
  onClaim: (input: { url: string; agreedToTerms: true }) => Promise<void>
}

/**
 * The whole acquisition flow, as one bar: type your address, click tiles, pay.
 *
 * This replaces a four-field form buried in a dashboard panel (URL, cluster-size dropdown, protect
 * checkbox, consent checkbox, submit). That form asked the visitor to understand the game's
 * mechanics before it would let them do anything, which is backwards for a product whose pitch is
 * that claiming space takes seconds. Here the two things that matter — who you are, and which
 * tiles — are the only two things on screen, and the brand resolves itself from the address as you
 * type, so the logo that will land on the map is visible before any money is involved.
 */
export function ClaimBar({
  selectedCount,
  totalCents,
  subtotalCents,
  discountCents,
  nextTier,
  blockedReason,
  protect,
  onProtectChange,
  onClearSelection,
  onClaim,
}: ClaimBarProps) {
  const [urlInput, setUrlInput] = useState('')
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const setPendingBrand = useGameStore((s) => s.setPendingBrand)

  const preview = useBrandPreview(urlInput)
  const brand = preview.status === 'ready' ? preview.brand : null

  // Published to the store so selected hexes can render this brand's plaque as a ghost preview —
  // seeing your own logo land on the tiles is the confirmation that the address was understood.
  useEffect(() => {
    setPendingBrand(brand)
  }, [brand, setPendingBrand])

  const canSubmit = brand !== null && selectedCount > 0 && !blockedReason && agreedToTerms && !isSubmitting

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitError(null)
    if (!brand || !canSubmit) return

    setIsSubmitting(true)
    try {
      await onClaim({ url: brand.url, agreedToTerms: true })
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not start checkout')
    } finally {
      setIsSubmitting(false)
    }
  }

  const logoSrc = logoProxyUrl(brand?.logoUrl)

  return (
    <form
      onSubmit={handleSubmit}
      className="pointer-events-auto w-full rounded-2xl border border-glass-border bg-glass p-3 shadow-glass-inset backdrop-blur-hud sm:p-4"
    >
      {/* Stacks on phones, one row from `sm` up. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <label htmlFor="claim-url" className="sr-only">
            Your website address
          </label>
          <div className="flex items-center gap-2.5 rounded-xl border border-glass-border bg-white/5 px-3 py-2.5 focus-within:border-hexwars-cyan">
            <BrandChip status={preview.status} logoSrc={logoSrc} domain={brand?.domain} />
            <input
              id="claim-url"
              type="text"
              inputMode="url"
              autoComplete="url"
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
              placeholder="yourcompany.com"
              className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/30 sm:text-sm"
            />
          </div>

          <p className="mt-1.5 min-h-[1rem] truncate text-[11px] leading-4">
            {preview.status === 'ready' && <span className="text-white/55">{preview.brand.title}</span>}
            {preview.status === 'loading' && <span className="text-white/40">Reading your site…</span>}
            {preview.status === 'error' && (
              <span className="flex items-center gap-1 text-hexwars-coral">
                <AlertCircle size={11} className="flex-none" />
                {preview.message}
              </span>
            )}
            {preview.status === 'invalid' && urlInput.trim().length > 3 && (
              <span className="text-white/40">{preview.message}</span>
            )}
            {preview.status === 'idle' && (
              <span className="text-white/35">We&apos;ll pull your logo and description automatically.</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 sm:flex-none">
          <SelectionSummary
            selectedCount={selectedCount}
            totalCents={totalCents}
            discountCents={discountCents}
            blockedReason={blockedReason}
            onClearSelection={onClearSelection}
          />

          <button
            type="submit"
            disabled={!canSubmit}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-5 py-3 font-display text-sm font-bold uppercase tracking-wide transition-colors sm:flex-none ${
              canSubmit
                ? 'bg-hexwars-green text-hexwars-bg shadow-glow-green'
                : 'cursor-not-allowed bg-white/10 text-white/30'
            }`}
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Swords size={16} />}
            {isSubmitting ? 'Opening…' : 'Claim'}
          </button>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-white/45">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={protect}
            onChange={(event) => onProtectChange(event.target.checked)}
            className="h-3.5 w-3.5 accent-hexwars-cyan"
          />
          <ShieldCheck size={12} className="text-hexwars-cyan" />
          Protect 10 min (+$15/hex)
        </label>

        {/* Consent stays an explicit, unchecked-by-default action: the EU/UK withdrawal waiver in
            Terms §5 only holds if the buyer affirmatively agreed before delivery began, and the
            checkout endpoint rejects the request outright if this flag isn't set. */}
        <label className="flex cursor-pointer items-start gap-1.5">
          <input
            type="checkbox"
            checked={agreedToTerms}
            onChange={(event) => setAgreedToTerms(event.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 flex-none accent-hexwars-green"
            required
          />
          <span>
            I agree to the{' '}
            <Link href="/terms" target="_blank" className="text-hexwars-cyan underline hover:no-underline">
              Terms
            </Link>{' '}
            &amp; no-refund policy, and want instant delivery.
          </span>
        </label>

        {nextTier && selectedCount > 0 && !blockedReason && (
          <span className="text-hexwars-green/80">
            +{nextTier.minHexes - selectedCount} more tiles → {Math.round(nextTier.rate * 100)}% off
          </span>
        )}

        {submitError && (
          <span className="flex items-center gap-1 text-hexwars-coral">
            <AlertCircle size={11} className="flex-none" />
            {submitError}
          </span>
        )}
      </div>
    </form>
  )
}

function BrandChip({
  status,
  logoSrc,
  domain,
}: {
  status: string
  logoSrc: string | null
  domain: string | undefined
}) {
  if (status === 'loading') {
    return <Loader2 size={18} className="flex-none animate-spin text-hexwars-cyan" aria-label="Reading your site" />
  }
  if (logoSrc) {
    return (
      <img
        src={logoSrc}
        alt={domain ? `${domain} logo` : ''}
        width={22}
        height={22}
        // Collapsed on error rather than left as a broken-image glyph: the logo is decorative
        // confirmation here, and the domain text beside it already carries the meaning.
        onError={(event) => {
          event.currentTarget.style.display = 'none'
        }}
        className="h-[22px] w-[22px] flex-none rounded bg-white object-contain p-0.5"
      />
    )
  }
  return <span aria-hidden className="h-[22px] w-[22px] flex-none rounded bg-white/10" />
}

function SelectionSummary({
  selectedCount,
  totalCents,
  discountCents,
  blockedReason,
  onClearSelection,
}: {
  selectedCount: number
  totalCents: number | null
  discountCents: number
  blockedReason: string | null
  onClearSelection: () => void
}) {
  if (selectedCount === 0) {
    return (
      <span className="flex-1 whitespace-nowrap rounded-xl border border-dashed border-glass-border px-3 py-3 text-center text-[11px] text-white/40 sm:flex-none">
        Tap tiles to claim
      </span>
    )
  }

  return (
    <div
      className={`flex flex-1 items-center gap-2 rounded-xl border px-3 py-2 sm:flex-none ${
        blockedReason ? 'border-hexwars-coral/40 bg-hexwars-coral/10' : 'border-glass-border bg-white/5'
      }`}
    >
      <div className="min-w-0">
        <div className="font-mono text-sm font-semibold leading-tight tabular-nums text-hexwars-green">
          {blockedReason ? '—' : totalCents !== null ? formatCents(totalCents) : '—'}
        </div>
        <div className="truncate text-[10px] leading-tight text-white/45">
          {blockedReason ??
            `${selectedCount} hex${discountCents > 0 ? ` · ${formatCents(discountCents)} off` : ''}`}
        </div>
      </div>
      <button
        type="button"
        onClick={onClearSelection}
        aria-label="Clear selection"
        className="flex-none rounded p-1 text-white/30 transition-colors hover:text-hexwars-coral"
      >
        <X size={14} />
      </button>
    </div>
  )
}
