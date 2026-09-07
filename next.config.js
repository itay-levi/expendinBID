/** @type {import('next').NextConfig} */

// Content-Security-Policy. 'unsafe-eval'/'unsafe-inline' on scripts are required by Next.js's dev
// bundler and its inline hydration bootstrap; tighten script-src to a nonce-based policy for
// production before launch (see ARCHITECTURE.md §24).
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://datafa.st",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  // Brand logos are third-party by design (favicons/og:images from buyer-submitted domains).
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://datafa.st",
  "frame-ancestors 'none'", // clickjacking: nothing may frame the payment/consent UI
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // HSTS is a no-op over plain HTTP (localhost) and only takes effect once served over TLS.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
]

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Both database drivers must be loaded from node_modules at runtime, not bundled. PGlite ships
    // its Postgres build as separate .wasm/.data files that webpack does not trace, so bundling it
    // produces a server that starts fine and then fails on the first query with a missing
    // pglite.data. `pg` has the same problem via its optional native bindings.
    serverComponentsExternalPackages: ['@electric-sql/pglite', 'pg'],
  },
  poweredByHeader: false, // don't advertise the framework/version
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

module.exports = nextConfig
