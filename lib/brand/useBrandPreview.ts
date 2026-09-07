'use client'

import { useEffect, useState } from 'react'
import { parseTargetUrl } from '@/lib/validation/targetUrlSchema'
import type { PendingBrand } from '@/lib/state/gameStore'

export type BrandPreviewState =
  | { status: 'idle' }
  | { status: 'invalid'; message: string }
  | { status: 'loading' }
  | { status: 'ready'; brand: PendingBrand }
  | { status: 'error'; message: string }

/** Typing pause before a lookup fires. Long enough that a typed-out domain is one request. */
export const BRAND_PREVIEW_DEBOUNCE_MS = 900

/**
 * Resolved previews, keyed by URL, for the life of the page.
 *
 * Without this, every edit-and-retype of the same address sent our scraper at the target again.
 * Real sites rate-limit bots — the address that prompted this cache started answering our own
 * requests with 429 after a handful of keystrokes — so the fix is to not ask twice.
 */
const previewCache = new Map<string, PendingBrand>()

/** A URL worth spending a request on: a hostname with a dot and a plausible TLD. */
function looksComplete(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return /\.[a-z]{2,}$/i.test(hostname)
  } catch {
    return false
  }
}

/**
 * Resolves the brand behind whatever the visitor is typing, live.
 *
 * The claim flow's whole promise is "type your address, see your logo on the map, pay" — so this
 * runs while they type rather than behind a submit button. That means it has to be cheap and
 * forgiving: debounced so a typed-out domain costs one request rather than one per keystroke, and
 * every stale response is discarded so a slow lookup for a half-typed domain can never overwrite
 * the result for the finished one.
 */
export function useBrandPreview(input: string): BrandPreviewState {
  const [state, setState] = useState<BrandPreviewState>({ status: 'idle' })

  useEffect(() => {
    const trimmed = input.trim()
    if (trimmed === '') {
      setState({ status: 'idle' })
      return
    }

    // Validated client-side first so obvious nonsense never costs a request. The server re-runs
    // the same validation plus the SSRF guard; this is a courtesy, not a control.
    const parsed = parseTargetUrl(trimmed)
    if (!parsed.success) {
      setState({ status: 'invalid', message: parsed.error })
      return
    }

    // Half-typed hostnames ("outbid.l") are never worth a request — and every one we skip is a
    // request the target does not rate-limit us for.
    if (!looksComplete(parsed.url)) {
      setState({ status: 'idle' })
      return
    }

    const cached = previewCache.get(parsed.url)
    if (cached) {
      setState({ status: 'ready', brand: cached })
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setState({ status: 'loading' })
      try {
        const response = await fetch('/api/brand/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: parsed.url }),
          signal: controller.signal,
        })
        const body = await response.json()

        const hostname = new URL(parsed.url).hostname

        // A site that blocks or rate-limits our scraper must still be able to buy territory. The
        // claim proceeds on the hostname plus the public favicon service, which needs no
        // cooperation from the target at all — and the server applies exactly the same fallback,
        // so what is previewed here is what lands on the map.
        const brand: PendingBrand =
          !response.ok || !body?.success
            ? {
                url: parsed.url,
                domain: hostname,
                title: hostname,
                description: '',
                logoUrl: `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`,
              }
            : {
                url: parsed.url,
                domain: hostname,
                title: body.data.title,
                description: body.data.description,
                logoUrl: body.data.logoUrl,
              }

        previewCache.set(parsed.url, brand)
        setState({ status: 'ready', brand })
      } catch (error: unknown) {
        // An abort is this effect being superseded, not a failure the visitor should ever see.
        if (error instanceof DOMException && error.name === 'AbortError') return

        // Network failure gets the same treatment as a refusal: fall back, never block the sale.
        const hostname = new URL(parsed.url).hostname
        const brand: PendingBrand = {
          url: parsed.url,
          domain: hostname,
          title: hostname,
          description: '',
          logoUrl: `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`,
        }
        previewCache.set(parsed.url, brand)
        setState({ status: 'ready', brand })
      }
    }, BRAND_PREVIEW_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [input])

  return state
}
