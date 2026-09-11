import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPageShell } from '@/components/legal/LegalPageShell'
import { SUPPORT_EMAIL } from '@/lib/site'

// DRAFT LEGAL TEXT — a standard-practice starting point for a digital-goods/advertising platform,
// not a substitute for review by qualified counsel in your operating jurisdictions. In particular:
// the withdrawal-rights waiver (§5) is only enforceable in the EU/UK if paired with a genuine
// affirmative checkbox at the point of purchase — see components/claim/ClaimBar.tsx and
// app/api/checkout/create-session/route.ts, which both require agreedToTerms === true before a
// charge is created. Confirm the exact contracting-entity name of your Merchant of Record (Dodo
// Payments, or Paddle for legacy transactions) for your region before publishing.
//
// Section numbers are referenced elsewhere (§5 at checkout, §7 by the chargeback handler and the
// refund policy) — renumber those too if these ever move.

export const metadata: Metadata = {
  title: 'Terms of Service — Hex Wars',
  description: 'Terms governing hex purchases, takeovers, and digital ad placements on Hex Wars.',
}

const LAST_UPDATED = 'September 11, 2026'

export default function TermsPage() {
  return (
    <LegalPageShell title="Terms of Service" lastUpdated={LAST_UPDATED}>
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of Hex Wars (the
        &ldquo;Service&rdquo;), including the purchase of hexagonal map tiles (&ldquo;Hexes&rdquo;), placement of
        domain and brand assets on Hexes (&ldquo;Digital Placements&rdquo;), and participation in hostile takeovers
        of Hexes owned by other users. By creating a Digital Placement, completing a purchase, or otherwise using
        the Service, you agree to be bound by these Terms and by our{' '}
        <Link href="/refund-policy">Refund Policy</Link> and <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>1. The Service</h2>
      <p>
        Hex Wars operates a shared, real-time, multiplayer map divided into Hexes. Users may purchase an unclaimed
        Hex, or acquire a Hex already owned by another user via a hostile takeover, by paying the then-current price
        shown at the point of purchase. Prices rise with the size of a purchase, with each takeover of the same Hex,
        and when a purchase is spread across separate areas of the map. Purchasing or taking over a Hex grants you a
        non-exclusive, revocable license to display your submitted domain, brand name, and associated brand assets on
        that Hex for as long as you continue to control it. You acquire no ownership of the Hex, the map, or any part
        of the Service.
      </p>

      <h2>2. Payments and Merchant of Record</h2>
      <p>
        Payments are processed by our payment provider, currently <strong>Dodo Payments</strong> (and, for some
        earlier transactions, Paddle), acting as our Merchant of Record and authorized reseller of the Digital
        Placements described in these Terms. The Merchant of Record is responsible for calculating and remitting
        applicable VAT, GST and sales tax; issuing invoices and receipts; processing your payment method; and handling
        payment-level inquiries. Hex Wars is responsible for operating the Service and fulfilling the Digital
        Placement itself. All prices are shown and charged in US dollars; applicable taxes may be added at checkout.
        Billing questions should be directed to the Merchant of Record using the contact details on your receipt;
        gameplay questions to {SUPPORT_EMAIL}.
      </p>

      <h2>3. Digital Goods; Instant Delivery</h2>
      <p>
        Hexes, capital claims, and takeovers are <strong>non-tangible digital goods</strong> — specifically, digital
        advertising and territory-display placements on a shared virtual map. They are not physical property,
        securities, currency, or a store of value, and control of a Hex confers no rights beyond the display license
        described in Section 1. Upon payment confirmation, your Digital Placement is delivered{' '}
        <strong>immediately and automatically</strong> by the Service updating the shared map. There is no shipping,
        no manual fulfillment step, and no meaningful delay between payment and delivery.
      </p>

      <h2>4. All Sales Are Final</h2>
      <p>
        <strong>
          ALL HEX PURCHASES, CAPITAL PLACEMENTS, AND HOSTILE TAKEOVERS ARE FINAL, ARE DELIVERED INSTANTLY, AND ARE
          NON-REFUNDABLE ONCE PAYMENT HAS BEEN PROCESSED.
        </strong>{' '}
        This applies regardless of the reason for the request, including a change of mind, dissatisfaction with map
        placement, position, appearance or visibility, the results a placement produces, or a subsequent loss of the
        Hex to another user.
      </p>
      <p>
        <strong>
          Losing control of a Hex to a hostile takeover by another user is an intended, disclosed core mechanic of
          the Service, not a service failure, defect, or error.
        </strong>{' '}
        By purchasing a Hex you acknowledge that any other user may pay the then-current takeover price to acquire it
        at any time the Hex is not protected, and that this outcome does not entitle you to a refund, partial refund,
        credit, or chargeback.
      </p>
      <p>
        The only exceptions are a payment for which no Digital Placement was delivered, and a duplicate charge caused
        by a technical error. Both are handled as described in our <Link href="/refund-policy">Refund Policy</Link>.
      </p>

      <h2>5. Waiver of Statutory Withdrawal Rights</h2>
      <p>
        If you are a consumer located in the European Union, United Kingdom, or another jurisdiction that grants a
        statutory right to withdraw from or cancel a contract for the supply of digital content not on a tangible
        medium within a set period (commonly a 14-day &ldquo;cooling-off&rdquo; period), you acknowledge and expressly
        agree that:
      </p>
      <ul>
        <li>the Digital Placement is supplied to you immediately and in full upon payment confirmation;</li>
        <li>you expressly request that performance begin immediately, before the end of any withdrawal period; and</li>
        <li>
          by giving this consent and completing checkout, <strong>you lose your right of withdrawal</strong> once
          delivery has begun, to the fullest extent permitted under applicable law (including, where applicable,
          Article 16(m) of EU Directive 2011/83/EU and the equivalent provisions of the UK Consumer Contracts
          (Information, Cancellation and Additional Charges) Regulations 2013).
        </li>
      </ul>
      <p>
        This waiver is presented to you as a separate, affirmative checkbox at checkout, immediately above the payment
        button, and is not implied merely by browsing the Service.
      </p>

      <h2>6. Listing Requirements and Acceptable Content</h2>
      <p>By submitting a website for display on a Hex, you represent and warrant that:</p>
      <ul>
        <li>
          the website is a real, working site belonging to a genuine business or project, and you own it or are
          authorized by its owner to advertise it;
        </li>
        <li>
          the website shows valid, truthful details of who operates it, and does not impersonate another company or
          brand;
        </li>
        <li>
          the website, its name, logo and description do not infringe any third party&rsquo;s trademark, copyright or
          other intellectual property right;
        </li>
        <li>
          the website does not host or link to malware or phishing; does not offer illegal goods or services,
          counterfeit goods, or unlicensed gambling; is not a scam, pyramid scheme, or deceptive financial offer; and
          contains no sexually explicit material, hate speech, harassment, or content otherwise prohibited by law.
        </li>
      </ul>
      <p>
        Your brand name, logo and description are read automatically from your website&rsquo;s own public metadata. You
        are responsible for that content as if you had submitted it directly.
      </p>

      <h2>7. Chargebacks and Fraud Prevention</h2>
      <p>
        Because Digital Placements are delivered instantly and are non-refundable under Section 4, initiating a
        payment-card chargeback, dispute, or reversal for a transaction where the Digital Placement was delivered as
        described — commonly known as &ldquo;friendly fraud&rdquo; — is a breach of these Terms. When a payment
        dispute is opened, the domain it was made for is automatically and permanently blocked from future purchases,
        and we may remove its placements. Paying with a payment method you are not authorized to use is prohibited and
        may be reported. This Section does not limit your right to dispute a transaction you did not authorize or that
        was processed in error; please contact us first so we can resolve a genuine problem directly.
      </p>

      <h2>8. Our Right to Remove Placements</h2>
      <p>
        We may refuse, delay, edit, hide, or permanently remove any Digital Placement, with or without notice,
        including where we believe these Terms may have been breached, a rights holder complains, the website&rsquo;s
        details are missing or invalid, the website stops working, or the placement creates legal, security, or
        reputational risk for the Service or its users. <strong>Removal does not entitle you to a refund.</strong>
      </p>

      <h2>9. No Verification; No Guarantee of Results</h2>
      <p>
        We do not verify that the companies shown on the map, or any claims their websites make, are genuine or
        accurate, and a placement is not an endorsement. Visitor, click and activity figures shown on the Service
        describe what our systems recorded and are not a promise of any outcome. What a placement achieves for you
        depends on its size, position, duration, your website, and many factors outside our control.
      </p>

      <h2>10. Fair Use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use bots, scripts or automated tools to purchase, bid, scrape, or interact with the Service;</li>
        <li>attempt to manipulate prices, protections, takeovers, or map state other than through normal purchases;</li>
        <li>
          exploit a bug or error for any advantage — report it to {SUPPORT_EMAIL} instead; any placement obtained
          through one may be removed without refund; or
        </li>
        <li>interfere with, overload, or attempt to gain unauthorized access to the Service or its infrastructure.</li>
      </ul>

      <h2>11. Availability and Changes to the Service</h2>
      <p>
        The Service is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis and may be unavailable,
        slow, or occasionally incorrect. We may change prices, pricing rules, protection options, map mechanics, and
        other features of the Service at any time. Changes apply to purchases made after they take effect.
      </p>

      <h2>12. Eligibility</h2>
      <p>
        You must be at least 18 years old, or the age of majority where you live, and able to form a binding contract.
        If you purchase on behalf of a business, you confirm you are authorized to bind it to these Terms.
      </p>

      <h2>13. Suspension and Termination</h2>
      <p>
        We may suspend or terminate your access to the Service at any time, with or without notice, for violation of
        these Terms, suspected fraud or abuse, or to comply with legal process. Sections 3&ndash;10 and 14&ndash;16
        survive any termination of your access.
      </p>

      <h2>14. Disclaimers and Limitation of Liability</h2>
      <p>
        To the fullest extent permitted by law, the Service is provided without warranties of any kind, express or
        implied, and Hex Wars&rsquo; aggregate liability arising out of or relating to the Service shall not exceed
        the total amount you paid for Digital Placements in the twelve (12) months preceding the claim. Nothing in
        these Terms limits liability that cannot be limited under applicable law.
      </p>

      <h2>15. Indemnity</h2>
      <p>
        You agree to indemnify and hold Hex Wars harmless from claims, losses and costs (including reasonable legal
        fees) arising from the website and content you submit, or from your breach of these Terms.
      </p>

      <h2>16. Governing Law</h2>
      <p>
        These Terms are governed by the laws of the jurisdiction in which Hex Wars is established, without regard to
        its conflict-of-laws principles, except where mandatory consumer-protection law of your country of residence
        provides otherwise.
      </p>

      <h2>17. Changes to These Terms</h2>
      <p>
        We may update these Terms from time to time. Material changes will be reflected by an updated &ldquo;Last
        updated&rdquo; date above. Continued use of the Service after changes take effect constitutes acceptance of
        the revised Terms.
      </p>

      <h2>18. Contact</h2>
      <p>
        Questions about these Terms can be sent to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. Billing and
        payment-method questions should be directed to the Merchant of Record using the contact details on your
        receipt.
      </p>
    </LegalPageShell>
  )
}
