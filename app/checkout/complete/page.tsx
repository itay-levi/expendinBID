import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { SUPPORT_EMAIL } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Payment received — Hex Wars',
  description: 'Your territory is being placed on the Hex Wars map.',
  // A per-buyer landing page, not something to surface in search.
  robots: { index: false, follow: false },
}

/**
 * Where the payment provider returns a buyer after checkout.
 *
 * Deliberately does not claim the territory is already live. Ownership changes only when the
 * provider's signed webhook arrives — usually seconds after payment, occasionally longer — so this
 * page says what is actually true and tells the buyer what to do if it takes too long. Checkout used
 * to fall back to https://example.com/checkout/complete here, a page that did not exist.
 */
export default function CheckoutCompletePage() {
  return (
    <main className="flex min-h-[100svh] w-full items-center justify-center bg-hexwars-bg px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-glass-border bg-glass p-6 shadow-glass-inset backdrop-blur-hud md:p-8">
        <CheckCircle2 size={36} className="text-hexwars-green" aria-hidden />
        <h1 className="mt-4 font-display text-2xl font-bold text-white">Payment received</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          Your territory is being placed on the map now. It normally appears within a few seconds of your payment
          confirming — the map refreshes on its own, so there is nothing more you need to do.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          If your logo has not appeared after a couple of minutes, email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-hexwars-cyan underline hover:no-underline">
            {SUPPORT_EMAIL}
          </a>{' '}
          with the receipt from your payment confirmation email and we will sort it out.
        </p>
        <p className="mt-3 text-xs leading-relaxed text-white/45">
          Placements are delivered instantly and all sales are final — see our{' '}
          <Link href="/refund-policy" className="text-hexwars-cyan underline hover:no-underline">
            refund policy
          </Link>
          .
        </p>

        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-hexwars-green px-4 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-hexwars-bg shadow-glow-green"
        >
          <ArrowLeft size={16} />
          Back to the map
        </Link>
      </div>
    </main>
  )
}
