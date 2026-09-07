import type { Metadata } from 'next'
import { LegalPageShell } from '@/components/legal/LegalPageShell'

// DRAFT LEGAL TEXT — this is a standard-practice starting point for a digital-goods/gaming
// platform, not a substitute for review by qualified counsel in your operating jurisdictions.
// In particular: the withdrawal-rights waiver (§6) is only enforceable in the EU/UK if paired
// with a genuine affirmative checkbox at the point of purchase — see ConquerPanel.tsx and
// app/api/checkout/create-session/route.ts, which both require agreedToTerms === true before
// a charge is created. Confirm Paddle's exact contracting-entity name/address for your region
// (Paddle.com Market Ltd vs. Paddle Payments Ltd differ by product/region) before publishing.

export const metadata: Metadata = {
  title: 'Terms of Service — Hex Wars',
  description: 'Terms governing hex purchases, takeovers, and digital ad placements on Hex Wars.',
}

const LAST_UPDATED = 'September 6, 2026'
const SUPPORT_EMAIL = 'support@hexwars.io'

export default function TermsPage() {
  return (
    <LegalPageShell title="Terms of Service" lastUpdated={LAST_UPDATED}>
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of Hex Wars (the
        &ldquo;Service&rdquo;), including the purchase of hexagonal map tiles (&ldquo;Hexes&rdquo;), placement of
        domain and brand assets on Hexes (&ldquo;Digital Placements&rdquo;), and participation in hostile takeovers
        of Hexes owned by other users. By creating a Digital Placement, completing a purchase, or otherwise using
        the Service, you agree to be bound by these Terms.
      </p>

      <h2>1. The Service</h2>
      <p>
        Hex Wars operates a shared, real-time, multiplayer isometric map divided into Hexes. Users may purchase an
        unclaimed Hex, or acquire a Hex already owned by another user via a hostile takeover, by paying the
        then-current price shown at the point of purchase. Purchasing or taking over a Hex grants you a
        non-exclusive, revocable license to display your submitted domain, brand name, and associated brand assets
        on that Hex for as long as you continue to control it.
      </p>

      <h2>2. Merchant of Record</h2>
      <p>
        All payments made through the Service are processed by <strong>Paddle Payments Ltd.</strong>
        (&ldquo;Paddle&rdquo;), acting as our appointed Merchant of Record and authorized reseller of the Digital
        Placements described in these Terms. Paddle is responsible for calculating and remitting applicable value
        added tax (VAT), goods and services tax (GST), and sales tax; issuing invoices and payment receipts;
        processing your payment method; and handling billing inquiries and payment-level disputes. Hex Wars is
        responsible for operating the Service and fulfilling the Digital Placement itself. Billing support
        questions should be directed to Paddle via the contact information on your receipt; gameplay and account
        questions should be directed to {SUPPORT_EMAIL}.
      </p>

      <h2>3. Digital Goods; Instant Delivery</h2>
      <p>
        Hexes, capital claims, and takeovers are <strong>non-tangible digital goods</strong> — specifically,
        time-limited digital advertising and territory-display utility placements on a shared virtual map. They are
        not physical property, securities, currency, or a store of value, and ownership of a Hex confers no rights
        beyond the display license described in Section 1. Upon successful payment confirmation, your Digital
        Placement is delivered <strong>immediately and automatically</strong> by the Service updating the shared
        map state and broadcasting that update to all connected users. There is no shipping, no manual fulfillment
        step, and no delay between payment and delivery.
      </p>

      <h2>4. No Refund Policy</h2>
      <p>
        <strong>
          ALL HEX PURCHASES, CAPITAL PLACEMENTS, AND HOSTILE TAKEOVERS ARE FINAL, ARE DELIVERED INSTANTLY, AND ARE
          NON-REFUNDABLE ONCE PAYMENT HAS BEEN PROCESSED.
        </strong>{' '}
        This applies regardless of the reason for the request, including but not limited to a change of mind,
        dissatisfaction with map placement or map position, or a subsequent loss of the Hex to another user.
      </p>
      <p>
        <strong>Losing control of a Hex to a hostile takeover by another user is an intended, disclosed core
        game mechanic of the Service, not a service failure, defect, or error.</strong> You acknowledge, by
        purchasing a Hex, that any other user may pay the then-current takeover price to acquire that same Hex
        at any time, and that this outcome does not entitle you to a refund, partial refund, credit, or
        chargeback. Requesting or filing a chargeback on the basis of a takeover you did not want does not
        constitute a valid billing dispute.
      </p>

      <h2>5. Waiver of Statutory Withdrawal Rights</h2>
      <p>
        If you are a consumer located in the European Union, United Kingdom, or another jurisdiction that grants a
        statutory right to withdraw from or cancel a contract for the supply of digital content not on a tangible
        medium within a set period (commonly a 14-day &ldquo;cooling-off&rdquo; period), you acknowledge and
        expressly agree that:
      </p>
      <ul>
        <li>the Digital Placement is supplied to you immediately and in full upon payment confirmation;</li>
        <li>
          you expressly request that performance begin immediately, before the end of any applicable withdrawal
          period; and
        </li>
        <li>
          by giving this consent and completing checkout, <strong>you lose your right of withdrawal</strong> once
          delivery of the Digital Placement has begun, to the fullest extent permitted under applicable law
          (including, where applicable, Article 16(m) of EU Directive 2011/83/EU and the equivalent provisions of
          the UK Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013).
        </li>
      </ul>
      <p>
        This waiver is presented to you as a separate, affirmative checkbox at checkout, immediately above the
        payment button, and is not implied merely by browsing the Service.
      </p>

      <h2>6. Acceptable Content; Domain Ownership Warranty</h2>
      <p>By submitting a domain, brand name, logo, or other brand asset for display on a Hex, you represent and warrant that:</p>
      <ul>
        <li>you own the submitted domain, or you have express authorization from its owner to display it and its associated branding on the Service;</li>
        <li>the submitted content does not infringe any third party&rsquo;s trademark, copyright, or other intellectual property right; and</li>
        <li>the submitted content is not illegal, does not host or link to malware, phishing pages, or other malicious software, and does not constitute hate speech, harassment, or content that is otherwise prohibited by applicable law.</li>
      </ul>
      <p>
        Hex Wars reserves the right, at its sole discretion and without refund, to remove any Digital Placement and
        suspend or terminate the associated account if it reasonably believes this Section has been violated.
      </p>

      <h2>7. Chargebacks and Fraud Prevention</h2>
      <p>
        Because Digital Placements are delivered instantly and are non-refundable under Section 4, initiating a
        payment-card chargeback, dispute, or reversal for a transaction where the Digital Placement was in fact
        delivered as described — commonly known as &ldquo;friendly fraud&rdquo; — is a breach of these Terms.
        Where we reasonably determine a chargeback was made in bad faith rather than to report genuine unauthorized
        use of a payment method or a genuine billing error, we may permanently suspend the associated account, the
        domain(s) submitted to it, and, to the extent technically identifiable, the originating IP address, from
        future use of the Service. This Section does not limit your right to dispute a transaction you did not
        authorize or that was processed in error; it addresses only disputes filed despite the purchased Digital
        Placement having been delivered as agreed.
      </p>

      <h2>8. Account Suspension and Termination</h2>
      <p>
        We may suspend or terminate your access to the Service at any time, with or without notice, for violation
        of these Terms, suspected fraud or abuse, or to comply with legal process. Sections 3&ndash;7 survive any
        termination of your access.
      </p>

      <h2>9. Disclaimers and Limitation of Liability</h2>
      <p>
        The Service is provided &ldquo;as is&rdquo; without warranties of any kind, express or implied, to the
        fullest extent permitted by law. To the fullest extent permitted by law, Hex Wars&rsquo; aggregate
        liability arising out of or relating to the Service shall not exceed the total amount you paid to Paddle
        for Digital Placements in the twelve (12) months preceding the claim. Nothing in these Terms limits
        liability that cannot be limited under applicable law.
      </p>

      <h2>10. Governing Law</h2>
      <p>
        These Terms are governed by the laws of the jurisdiction in which Hex Wars is established, without regard
        to its conflict-of-laws principles, except where mandatory consumer-protection law of your country of
        residence provides otherwise.
      </p>

      <h2>11. Changes to These Terms</h2>
      <p>
        We may update these Terms from time to time. Material changes will be reflected by an updated &ldquo;Last
        updated&rdquo; date above. Continued use of the Service after changes take effect constitutes acceptance
        of the revised Terms.
      </p>

      <h2>12. Contact</h2>
      <p>
        Questions about these Terms can be sent to{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. Billing and payment-method questions should be
        directed to Paddle using the contact details on your payment receipt.
      </p>
    </LegalPageShell>
  )
}
