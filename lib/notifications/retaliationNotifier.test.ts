import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Empire, HexTile } from '@/types/game'

vi.mock('@/lib/security/guardedFetch', () => ({ guardedFetch: vi.fn() }))

import { guardedFetch } from '@/lib/security/guardedFetch'
import { notifyDefenderOfTakeover } from './retaliationNotifier'

const mockedFetch = vi.mocked(guardedFetch)

const empire = (id: string, notifyWebhookUrl: string | null = null): Empire => ({
  id,
  domain: id,
  name: id,
  url: `https://${id}`,
  logoUrl: '',
  primaryColorHex: '#8A2BE2',
  ogTitle: id,
  ogDescription: '',
  capitalHexId: '',
  foundedAt: '2026-01-01T00:00:00.000Z',
  notifyWebhookUrl,
})

const hex: HexTile = {
  id: 'hex_1,0',
  coord: { q: 1, r: 0 },
  ownerId: 'attacker.com',
  isCapital: false,
  lastPricePaidCents: 1_500,
  isContested: false,
  ownedSince: '2026-01-01T00:00:00.000Z',
  lockedUntil: null,
}

beforeEach(() => {
  mockedFetch.mockReset()
})

describe('notifyDefenderOfTakeover', () => {
  it('sends nothing to a defender who never opted in', async () => {
    await notifyDefenderOfTakeover(empire('defender.com'), hex, empire('attacker.com'))
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  it('POSTs the takeover through the SSRF-guarded fetch, never following redirects', async () => {
    mockedFetch.mockResolvedValue({ status: 204, ok: true, finalUrl: '', contentType: '', body: Buffer.alloc(0) })
    await notifyDefenderOfTakeover(
      empire('defender.com', 'https://hooks.defender.com/hex'),
      hex,
      empire('attacker.com'),
    )

    expect(mockedFetch).toHaveBeenCalledTimes(1)
    const [url, options] = mockedFetch.mock.calls[0]!
    expect(url).toBe('https://hooks.defender.com/hex')
    expect(options).toMatchObject({ method: 'POST', maxRedirects: 0 })
    expect(JSON.parse(options.jsonBody as string)).toMatchObject({
      event: 'hex.annexed',
      hexId: 'hex_1,0',
      attackerDomain: 'attacker.com',
    })
  })

  it('never lets a failing webhook break the takeover that triggered it', async () => {
    mockedFetch.mockRejectedValue(new Error('Host resolves to a private address'))
    await expect(
      notifyDefenderOfTakeover(empire('defender.com', 'http://169.254.169.254/'), hex, empire('attacker.com')),
    ).resolves.toBeUndefined()
  })

  it('tolerates the defender’s endpoint answering with an error', async () => {
    mockedFetch.mockResolvedValue({ status: 500, ok: false, finalUrl: '', contentType: '', body: Buffer.alloc(0) })
    await expect(
      notifyDefenderOfTakeover(empire('defender.com', 'https://hooks.defender.com/hex'), hex, empire('attacker.com')),
    ).resolves.toBeUndefined()
  })
})
