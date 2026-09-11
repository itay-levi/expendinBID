import { NextResponse } from 'next/server'
import { getRepositories } from '@/lib/repository'
import { handleDodoWebhook } from '@/lib/payments/dodoWebhook'
import { BodyTooLargeError, readBodyWithLimit } from '@/lib/http/readBodyWithLimit'

// Node runtime: settlement reaches the database drivers and the SSRF-guarded scraper.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Dodo payment events are a few kilobytes; anything near this is not one of them. */
const MAX_WEBHOOK_BYTES = 256 * 1024

/**
 * Dodo Payments webhook. The only place a Dodo payment turns into territory — see
 * lib/payments/dodoWebhook.ts for the handling and lib/payments/settleTakeover.ts for settlement.
 */
export async function POST(request: Request): Promise<Response> {
  let rawBody: string
  try {
    // Text, never parsed first: the signature covers these exact bytes.
    rawBody = await readBodyWithLimit(request, MAX_WEBHOOK_BYTES)
  } catch (error: unknown) {
    if (error instanceof BodyTooLargeError) return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    throw error
  }

  const outcome = await handleDodoWebhook(
    rawBody,
    {
      id: request.headers.get('webhook-id'),
      timestamp: request.headers.get('webhook-timestamp'),
      signature: request.headers.get('webhook-signature'),
    },
    { secret: process.env.DODO_PAYMENTS_WEBHOOK_SECRET, getRepositories },
  )
  return NextResponse.json(outcome.body, { status: outcome.status })
}
