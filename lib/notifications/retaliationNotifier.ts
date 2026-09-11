import type { Empire, HexTile } from '@/types/game'
import { logger } from '@/lib/logger'
import { guardedFetch } from '@/lib/security/guardedFetch'

// Notifies a defender when their hex is taken. Deliberately webhook-only and opt-in:
//
// The product spec described emailing "the previous owner" a counter-attack alert. This app has
// no signup and collects no email address (checkout is anonymous, URL-only — see ARCHITECTURE.md
// §16), so there is no address on file to email. The only way to get one would be to scrape or
// guess it from the domain (info@, admin@, whois), then send unsolicited marketing/alert mail to
// it — that's a spam/abuse pattern regardless of how the message is framed, and this app doesn't
// do it. What it *can* do safely: let a buyer optionally register their own webhook URL at
// purchase time (Empire.notifyWebhookUrl), and POST to that if they set one. That's a normal,
// consent-based integration pattern, not outreach to a third party who never opted in.
export async function notifyDefenderOfTakeover(defender: Empire, hex: HexTile, attacker: Empire): Promise<void> {
  if (!defender.notifyWebhookUrl) return

  // The webhook URL was supplied by the defender at their own purchase time, so a malicious buyer
  // could register an internal address (e.g. a cloud metadata IP) to make our server hit it whenever
  // someone attacks their hex. guardedFetch validates the address at connect time — the one check a
  // DNS-rebinding domain cannot slip past — and never follows a redirect for a POST.
  const payload = {
    event: 'hex.annexed',
    hexId: hex.id,
    attackerUrl: attacker.url,
    attackerDomain: attacker.domain,
    lostAt: new Date().toISOString(),
  }

  try {
    const response = await guardedFetch(defender.notifyWebhookUrl, {
      method: 'POST',
      jsonBody: JSON.stringify(payload),
      timeoutMs: 5_000,
      maxBytes: 64_000,
      maxRedirects: 0,
    })
    if (!response.ok) {
      logger.warn('Defender webhook notification failed', { empireId: defender.id, status: response.status })
    }
  } catch (error: unknown) {
    logger.warn('Defender webhook notification errored', {
      empireId: defender.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
