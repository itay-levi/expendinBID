import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPageShell } from '@/components/legal/LegalPageShell'
import { SUPPORT_EMAIL } from '@/lib/site'

// DRAFT LEGAL TEXT — a standard starting point for instantly-delivered digital goods, not a
// substitute for review by counsel in your operating jurisdictions. Payment providers acting as
// Merchant of Record (Dodo Payments, Paddle) require a published refund policy to approve an
// account; this page is that policy, and it is linked from checkout, the footer and the Terms.

export const metadata: Metadata = {
  title: 'Refund Policy — Hex Wars',
  description: 'All Hex Wars placements are delivered instantly and all sales are final.',
}

const LAST_UPDATED = 'September 11, 2026'

export default function RefundPolicyPage() {
  return (
    <LegalPageShell title="Refund Policy" lastUpdated={LAST_UPDATED}>
      <p>
        <strong>All sales are final.</strong> Hex Wars sells digital advertising placements on a shared, live map.
        Each placement is delivered to you instantly and automatically the moment your payment is confirmed, so
        once a placement has been delivered it cannot be returned and is not refundable.
      </p>

      <h2>No refunds are given for</h2>
      <ul>
        <li>changing your mind after your placement has been delivered;</li>
        <li>dissatisfaction with where your territory sits on the map, how it looks, or how much it is seen;</li>
        <li>
          another company taking over your tiles. Takeovers are the core, fully disclosed mechanic of the game — any
          user may pay the current price to take any unprotected tile at any time;
        </li>
        <li>the traffic, clicks, sales or other results your placement does or does not produce;</li>
        <li>
          removal of a placement that breaks our{' '}
          <Link href="/terms">Terms of Service</Link> (for example, content you are not authorised to use, or a site
          hosting malware or scams).
        </li>
      </ul>

      <h2>When we will make it right</h2>
      <p>Two things are not &ldquo;sales&rdquo; at all, and we will always fix them:</p>
      <ul>
        <li>
          <strong>You paid but your placement was never delivered</strong> — for example, because the tiles you chose
          were taken by someone else while you were paying. We will either deliver equivalent territory or refund the
          payment in full.
        </li>
        <li>
          <strong>You were charged more than once</strong> for the same purchase because of a technical error. The
          duplicate charge is refunded.
        </li>
      </ul>
      <p>
        To raise either, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> within 14 days of the payment,
        with the receipt from your confirmation email.
      </p>

      <h2>Chargebacks</h2>
      <p>
        Please contact us before disputing a payment with your bank. Disputing a charge for a placement that was
        delivered as described breaches our Terms, and the domain involved will be permanently blocked from future
        purchases (Terms of Service, section 7). This does not affect your right to dispute a payment you did not
        authorise.
      </p>

      <h2>Your statutory rights</h2>
      <p>
        By completing checkout you ask for your placement to be delivered immediately and acknowledge that you lose
        any statutory right to withdraw once delivery has begun (Terms of Service, section 5). Nothing in this policy
        limits rights that cannot be excluded under the law of your country.
      </p>
    </LegalPageShell>
  )
}
