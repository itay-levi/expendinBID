import type { Metadata } from 'next'
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

export const metadata: Metadata = {
  title: 'HEX WARS: Ad Takeover',
  description: 'Real-time multiplayer ad-takeover strategy on a live hex map.',
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
