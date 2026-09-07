'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Swords, Loader2, AlertCircle, X, ShieldCheck, TrendingUp, MousePointerClick } from 'lucide-react'
import { useBrandPreview } from '@/lib/brand/useBrandPreview'
import { logoProxyUrl } from '@/lib/brand/logoProxyUrl'
import { useGameStore } from '@/lib/state/gameStore'
import { formatCents } from '@/lib/pricing/takeoverPricing'

type ClaimBarProps = {
  selectedCount: number
  totalCents: number | null
  /** Charged above the flat rate — the land-grab premium, shown so the total is never a mystery. */
  escalationCents: number
  /** Charged for occupying several separate places on the map. */
  spreadCents: number
  /** How many separate patches of map this claim covers. */
  billboardCount: number
  /** What one more tile of open ground would add, so the escalation is visible before it is paid. */
  nextTileCents: number
  blockedReason: string | null
  protect: boolean
  onProtectChange: (protect: boolean) => void
  onClearSelection: () => void
  onClaim: (input: { url: string; agreedToTerms: true }) => Promise<void>
}

/**
 * The whole acquisition flow as one bar, laid out as three numbered steps.
 *
 * The steps are explicit because the flow was not self-evident without them: a buyer would type a
 * URL, watch their logo appear on the map, and then have no idea what they owed or how to pay. The
 * money is now the loudest thing in the bar, the button names the amount rather than saying
 * "Claim", and the price of the next tile is shown before it is clicked, so the escalating cost is
 * something the buyer watches happen rather than discovers at checkout.
 */
export function ClaimBar({
  selectedCount,
  totalCents,
  escalationCents,
  spreadCents,
  billboardCount,
  nextTileCents,
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

  // Published to the store so selected tiles render this brand immediately — seeing your own logo
  // land on the map is the confirmation that the address was understood.
  useEffect(() => {
    setPendingBrand(brand)
  }, [brand, setPendingBrand])

  const hasBrand = brand !== null
  const hasTiles = selectedCount > 0
  const canSubmit = hasBrand && hasTiles && !blockedReason && agreedToTerms && !isSubmitting

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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
        {/* Step 1 — who you are */}
        <div className="min-w-0 flex-1">
          <StepLabel index={1} label="Your site" done={hasBrand} />
          <div className="mt-1 flex items-center gap-2.5 rounded-xl border border-glass-border bg-white/5 px-3 py-2.5 focus-within:border-hexwars-cyan">
            <BrandChip status={preview.status} logoSrc={logoSrc} domain={brand?.domain} />
            <label htmlFor="claim-url" className="sr-only">
              Your website address
            </label>
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
          <p className="mt-1 min-h-[1rem] truncate text-[11px] leading-4">
            {preview.status === 'ready' && <span className="text-white/55">{preview.brand.title}</span>}
            {preview.status === 'loading' && <span className="text-white/40">Reading your site…</span>}
            {preview.status === 'invalid' && urlInput.trim().length > 3 && (
              <span className="text-white/40">{preview.message}</span>
            )}
            {preview.status === 'idle' && (
              <span className="text-white/35">We&apos;ll pull your logo and description automatically.</span>
            )}
          </p>
        </div>

        {/* Step 2 — how much ground */}
        <div className="min-w-0 flex-1">
          <StepLabel index={2} label="Pick your tiles" done={hasTiles} />
          <div
            className={`mt-1 flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
              blockedReason ? 'border-hexwars-coral/40 bg-hexwars-coral/10' : 'border-glass-border bg-white/5'
            }`}
          >
            {hasTiles ? (
              <>
                <span className="font-mono text-xl font-bold leading-none tabular-nums text-white">
                  {selectedCount}
                </span>
                <span className="text-[11px] leading-tight text-white/45">
                  tile{selectedCount === 1 ? '' : 's'}
                  <br />
                  selected
                </span>
                <button
                  type="button"
                  onClick={onClearSelection}
                  aria-label="Clear selection"
                  className="ml-auto flex-none rounded p-1 text-white/30 transition-colors hover:text-hexwars-coral"
                >
                  <X size={14} />
                </button>
              </>
            ) : (
              <span className="flex items-center gap-1.5 text-[11px] text-white/40">
                <MousePointerClick size={13} />
                Tap tiles on the map
              </span>
            )}
          </div>
          <p className="mt-1 min-h-[1rem] truncate text-[11px] leading-4">
            {blockedReason ? (
              <span className="text-hexwars-coral">{blockedReason}</span>
            ) : (
              // The escalation, stated before it is paid rather than discovered at checkout.
              <span className="flex items-center gap-1 text-hexwars-cyan/80">
                <TrendingUp size={11} className="flex-none" />
                Next tile {formatCents(nextTileCents)}
                {billboardCount > 1 && ` · ${billboardCount} billboards`}
              </span>
            )}
          </p>
        </div>

        {/* Step 3 — the money */}
        <div className="min-w-0 lg:w-64 lg:flex-none">
          <StepLabel index={3} label="Pay" done={false} />
          <div className="mt-1 rounded-xl border border-glass-border bg-white/5 px-3 py-2">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-white/45">Total</span>
              <span className="font-mono text-2xl font-bold leading-none tabular-nums text-hexwars-green">
                {totalCents !== null ? formatCents(totalCents) : '—'}
              </span>
            </div>
            {!blockedReason && (escalationCents > 0 || spreadCents > 0) && (
              <div className="mt-1 space-y-0.5 border-t border-glass-border pt-1 text-[10px] text-white/40">
                {escalationCents > 0 && (
                  <div className="flex justify-between">
                    <span>Size premium</span>
                    <span className="font-mono tabular-nums">{formatCents(escalationCents)}</span>
                  </div>
                )}
                {spreadCents > 0 && (
                  <div className="flex justify-between">
                    <span>{billboardCount} billboards</span>
                    <span className="font-mono tabular-nums">{formatCents(spreadCents)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={!canSubmit}
            className={`mt-1.5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 font-display text-sm font-bold uppercase tracking-wide transition-colors ${
              canSubmit
                ? 'bg-hexwars-green text-hexwars-bg shadow-glow-green'
                : 'cursor-not-allowed bg-white/10 text-white/30'
            }`}
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Swords size={16} />}
            {/* Names the amount rather than saying "Claim": the button is the last chance to be
                unambiguous about what pressing it costs. */}
            {isSubmitting
              ? 'Opening checkout…'
              : totalCents !== null && canSubmit
                ? `Pay ${formatCents(totalCents)}`
                : !hasBrand
                  ? 'Enter your site'
                  : !hasTiles
                    ? 'Pick tiles'
                    : 'Accept terms'}
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
          Protect 10 min (+$15/tile)
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

function StepLabel({ index, label, done }: { index: number; label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
      <span
        className={`flex h-4 w-4 flex-none items-center justify-center rounded-full font-mono text-[9px] ${
          done ? 'bg-hexwars-green text-hexwars-bg' : 'bg-white/10 text-white/50'
        }`}
      >
        {done ? '✓' : index}
      </span>
      <span className={done ? 'text-hexwars-green/80' : 'text-white/40'}>{label}</span>
    </div>
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
