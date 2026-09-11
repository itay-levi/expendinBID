import type { Metadata, Viewport } from 'next'
import { Space_Grotesk, Inter, JetBrains_Mono } from 'next/font/google'
import Script from 'next/script'
import './globals.css'

const display = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['500', '700'],
})

const body = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600'],
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['500', '700'],
})

const TITLE = 'HEX WARS: Ad Takeover'
const DESCRIPTION = 'Real-time multiplayer ad-takeover strategy on a live hex map.'

/** Absolute base for share previews. A malformed SITE_URL must not break every page's metadata. */
function metadataBase(): URL {
  try {
    return new URL(process.env.SITE_URL || 'http://localhost:3000')
  } catch {
    return new URL('http://localhost:3000')
  }
}

export const metadata: Metadata = {
  metadataBase: metadataBase(),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', siteName: 'Hex Wars' },
  twitter: { card: 'summary', title: TITLE, description: DESCRIPTION },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Matches the map's background, so mobile browser chrome blends into the scene.
  themeColor: '#0B0E14',
}

// Public site identifier, not a secret — safe to inline into the client bundle (NEXT_PUBLIC_*).
// The realtime-visitors *read* API key stays server-only (see app/api/analytics/live-visitors).
const dataFastWebsiteId = process.env.NEXT_PUBLIC_DATAFAST_WEBSITE_ID
const dataFastDomain = process.env.NEXT_PUBLIC_DATAFAST_DOMAIN

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        {children}
        {dataFastWebsiteId && dataFastDomain && (
          <Script
            defer
            data-website-id={dataFastWebsiteId}
            data-domain={dataFastDomain}
            src="https://datafa.st/js/script.js"
          />
        )}
      </body>
    </html>
  )
}
