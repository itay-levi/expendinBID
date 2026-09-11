import type { Metadata } from 'next'
import { LegalPageShell } from '@/components/legal/LegalPageShell'
import { SUPPORT_EMAIL } from '@/lib/site'

// DRAFT LEGAL TEXT — see the note at the top of app/terms/page.tsx. GDPR/CCPA compliance also
// depends on operational facts this file can't verify on its own (your actual data retention
// periods, whether you rely on legitimate interest vs. consent for a given processing purpose,
// your actual list of sub-processors and their DPAs, and whether you need a Data Protection
// Officer or a US state-specific "Do Not Sell/Share" mechanism) — confirm each against your
// actual infrastructure and counsel's advice before publishing.

export const metadata: Metadata = {
  title: 'Privacy Policy — Hex Wars',
  description: 'How Hex Wars collects, uses, and protects your data.',
}

const LAST_UPDATED = 'September 6, 2026'

export default function PrivacyPage() {
  return (
    <LegalPageShell title="Privacy Policy" lastUpdated={LAST_UPDATED}>
      <p>
        This Privacy Policy explains what data Hex Wars (&ldquo;we,&rdquo; &ldquo;us&rdquo;) collects when you use
        the Service, why we collect it, who we share it with, and the rights available to you under applicable
        data protection law, including the EU/UK General Data Protection Regulation (&ldquo;GDPR&rdquo;) and the
        California Consumer Privacy Act as amended (&ldquo;CCPA&rdquo;).
      </p>

      <h2>1. Data We Collect</h2>
      <h3>Technical &amp; telemetry data</h3>
      <p>
        When you connect to the Service, we automatically collect your IP address, browser and device
        specifications (user agent, screen size, WebGL capability), WebSocket connection logs, and a record of
        your hex-interaction events (hovers, selections, purchase attempts, takeovers) needed to operate the
        real-time map and to detect abusive or bot-driven behavior.
      </p>
      <h3>Domain and brand data</h3>
      <p>
        When you submit a URL for a Digital Placement, we fetch and store the page&rsquo;s publicly available
        title, meta description, and favicon/logo image for display on your Hex. This data is fetched from the URL
        you provide and is not derived from any private or authenticated source. See our Terms of Service for the
        warranty you make about your right to display this content.
      </p>
      <h3>Billing data</h3>
      <p>
        Full payment card numbers, CVV codes, and billing addresses are collected and processed solely by{' '}
        <strong>Paddle Payments Ltd.</strong> (&ldquo;Paddle&rdquo;), our Merchant of Record. Hex Wars never
        receives or stores your full card number or CVV. We receive from Paddle only the minimum transaction
        metadata needed to apply a purchase to the correct Hex (an order reference, the amount paid, and the
        purchase timestamp).
      </p>

      <h2>2. How We Use Data</h2>
      <ul>
        <li>To operate the real-time WebSocket connection and keep every connected client&rsquo;s map state in sync;</li>
        <li>To detect and prevent fraud, bot activity, and bid/price manipulation;</li>
        <li>To display public gameplay activity — such as recent takeovers and market totals — on the live ticker and leaderboard, which is visible to all users of the Service by design;</li>
        <li>To respond to support requests and enforce our Terms of Service; and</li>
        <li>To comply with legal obligations, including those imposed on us by our payment processor.</li>
      </ul>

      <h2>3. Legal Basis for Processing (EU/UK Users)</h2>
      <p>
        We process technical and gameplay data on the basis of our legitimate interest in operating and securing
        the Service, and billing data is processed by Paddle as necessary to perform the purchase contract you
        enter into at checkout. Where required by law, we rely on your consent, which you may withdraw at any
        time by discontinuing use of the Service and contacting us as described in Section 6.
      </p>

      <h2>4. Third-Party Data Processors</h2>
      <p>The following third parties process data on our behalf:</p>
      <ul>
        <li><strong>Paddle Payments Ltd.</strong> — payment processing, tax calculation and remittance, and Merchant of Record services;</li>
        <li><strong>Database/hosting provider</strong> — stores Hex ownership records, transaction history, and account data;</li>
        <li><strong>Real-time/WebSocket infrastructure provider</strong> — relays live map-state updates between connected clients; and</li>
        <li>any analytics provider we enable is limited to aggregate, non-identifying usage metrics and is disclosed here if and when activated.</li>
      </ul>
      <p>
        We do not sell your personal information to third parties for their own independent marketing purposes.
      </p>

      <h2>5. Data Retention</h2>
      <p>
        We retain gameplay and technical data for as long as reasonably necessary to operate the Service, resolve
        disputes, and enforce our Terms, and in any case no longer than required by applicable law. Billing records
        are retained by Paddle in accordance with Paddle&rsquo;s own privacy policy and applicable tax-record
        retention requirements.
      </p>

      <h2>6. Your Rights</h2>
      <p>
        Depending on your location, you may have the right to request access to, correction of, or deletion of
        your personal data, to object to or restrict certain processing, to receive a copy of your data in a
        portable format, and — for California residents — to opt out of the &ldquo;sale&rdquo; or
        &ldquo;sharing&rdquo; of personal information as defined by the CCPA (Hex Wars does not sell personal
        information for monetary consideration). To exercise any of these rights, including a request to remove a
        submitted domain and its associated brand assets from the Service, email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> from the address associated with your request. We
        will respond within the timeframe required by applicable law.
      </p>

      <h2>7. Cookies and Local Storage</h2>
      <p>
        The Service uses browser local storage to remember lightweight preferences (such as your sound setting)
        on your device. This data is not transmitted to us and is not used for cross-site tracking or advertising.
      </p>

      <h2>8. Children&rsquo;s Privacy</h2>
      <p>
        The Service is not directed to children under 16, and we do not knowingly collect personal data from
        children under that age. If you believe a child has provided us with personal data, contact us at{' '}
        {SUPPORT_EMAIL} and we will take steps to delete it.
      </p>

      <h2>9. International Data Transfers</h2>
      <p>
        Your data may be processed in countries other than your own, including by our third-party processors
        listed in Section 4. Where required, we rely on appropriate safeguards such as the EU Standard
        Contractual Clauses to protect data transferred internationally.
      </p>

      <h2>10. Security</h2>
      <p>
        We apply technical and organizational measures designed to protect data against unauthorized access,
        alteration, or loss, including SSRF-hardened server-side handling of any URL you submit and signature
        verification on payment webhooks from Paddle. No system is perfectly secure, and we cannot guarantee
        absolute security.
      </p>

      <h2>11. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Material changes will be reflected by an updated
        &ldquo;Last updated&rdquo; date above.
      </p>

      <h2>12. Contact</h2>
      <p>
        For any privacy, data-deletion, or legal inquiry, contact{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </LegalPageShell>
  )
}
