import type { Empire, HexTile } from '@/types/game'
import { axialKey, generateHexagonGrid, type AxialCoord } from '@/lib/hex/hexMath'
import { MAP_RADIUS } from '@/lib/hex/mapConfig'

// Local demo data so the map is actually populated and playable without a database.
// Everything here is fictional — see ARCHITECTURE.md §14 on why real brand names/logos aren't
// baked into demo data. Swap this out entirely once the real-time layer (§8) feeds the store.

export const DEMO_MODE_NOTICE = 'Demo data — not a live map'

/**
 * Self-contained SVG data URI so texture loading never depends on the network (or on a CDN that
 * might 404). A mark-plus-wordmark rather than a bare initial: a single letter on a tile gives no
 * clue that a company owns it, which is the whole thing an occupied hex has to communicate.
 */
function placeholderLogo(name: string, colorHex: string): string {
  const initial = (name.trim()[0] ?? '?').toUpperCase()
  const wordmark = name.toUpperCase().slice(0, 12)
  // Rough advance width for the condensed uppercase face below; enough to keep the wordmark
  // inside the viewBox without measuring text, which SVG can't do at build time.
  const fontSize = Math.min(34, Math.floor(420 / Math.max(wordmark.length, 1)))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<rect width="256" height="256" rx="52" fill="#0B0E14" fill-opacity="0.92"/>
<rect x="6" y="6" width="244" height="244" rx="48" fill="none" stroke="${colorHex}" stroke-width="7"/>
<circle cx="128" cy="98" r="52" fill="${colorHex}" fill-opacity="0.16"/>
<text x="128" y="98" font-family="system-ui,sans-serif" font-size="62" font-weight="700"
 fill="${colorHex}" text-anchor="middle" dominant-baseline="central">${initial}</text>
<text x="128" y="184" font-family="system-ui,sans-serif" font-size="${fontSize}" font-weight="600"
 letter-spacing="1.5" fill="#EDF1F7" text-anchor="middle" dominant-baseline="central">${wordmark}</text>
</svg>`
  return `data:image/svg+xml;base64,${typeof window === 'undefined' ? Buffer.from(svg).toString('base64') : btoa(svg)}`
}

type DemoEmpireSpec = {
  id: string
  name: string
  domain: string
  colorHex: string
  ogTitle: string
  ogDescription: string
  coords: AxialCoord[]
}

const DEMO_EMPIRES: DemoEmpireSpec[] = [
  {
    id: 'lattice.dev',
    name: 'LATTICE',
    domain: 'lattice.dev',
    colorHex: '#FBBF24',
    ogTitle: 'Lattice — Structured data infrastructure',
    ogDescription: 'Schema-first pipelines for teams that outgrew spreadsheets.',
    coords: [
      { q: -2, r: 4 },
      { q: -1, r: 3 },
      { q: -1, r: 4 },
      { q: 0, r: 3 },
    ],
  },
  {
    id: 'orbitcache.io',
    name: 'ORBITCACHE',
    domain: 'orbitcache.io',
    colorHex: '#38BDF8',
    ogTitle: 'OrbitCache — Edge caching without the config',
    ogDescription: 'Global cache invalidation in under 50ms.',
    coords: [
      { q: -4, r: -1 },
      { q: -3, r: -1 },
      { q: -4, r: 0 },
    ],
  },
  {
    id: 'pixeldeck.app',
    name: 'PIXELDECK',
    domain: 'pixeldeck.app',
    colorHex: '#F472B6',
    ogTitle: 'PixelDeck — Presentations that build themselves',
    ogDescription: 'Turn a doc into a deck in one click.',
    coords: [
      { q: 3, r: -4 },
      { q: 4, r: -4 },
    ],
  },
  {
    id: 'voltgrid.co',
    name: 'VOLTGRID',
    domain: 'voltgrid.co',
    colorHex: '#FB923C',
    ogTitle: 'VoltGrid — Load balancing for spiky traffic',
    ogDescription: 'Down to its last stronghold on the map.',
    coords: [{ q: 5, r: 1 }],
  },
]

export function hexIdForCoord(coord: AxialCoord): string {
  return `hex_${axialKey(coord)}`
}

export type DemoSeed = { empires: Empire[]; hexes: HexTile[] }

export function buildDemoSeed(now: Date = new Date()): DemoSeed {
  const foundedAt = new Date(now.getTime() - 70 * 60 * 1000).toISOString()
  const empires: Empire[] = []
  const hexes: HexTile[] = []

  // EVERY coordinate on the map gets a record, unclaimed ones included. Seeding only the owned
  // hexes leaves the rest absent from the store, and anything doing a lookup by hex id (the hover
  // tooltip, the adjacency check, the checkout endpoint) silently finds nothing.
  for (const coord of generateHexagonGrid(MAP_RADIUS)) {
    hexes.push({
      id: hexIdForCoord(coord),
      coord,
      ownerId: null,
      isCapital: false,
      lastPricePaidCents: 0,
      isContested: false,
      ownedSince: null,
      lockedUntil: null,
    })
  }
  const hexIndexById = new Map(hexes.map((h, index) => [h.id, index]))

  for (const spec of DEMO_EMPIRES) {
    const capitalCoord = spec.coords[0]
    if (!capitalCoord) continue

    empires.push({
      id: spec.id,
      domain: spec.domain,
      url: `https://${spec.domain}`,
      name: spec.name,
      logoUrl: placeholderLogo(spec.name, spec.colorHex),
      primaryColorHex: spec.colorHex,
      ogTitle: spec.ogTitle,
      ogDescription: spec.ogDescription,
      capitalHexId: hexIdForCoord(capitalCoord),
      foundedAt,
      notifyWebhookUrl: null,
    })

    spec.coords.forEach((coord, index) => {
      const id = hexIdForCoord(coord)
      const existingIndex = hexIndexById.get(id)
      const owned: HexTile = {
        id,
        coord,
        ownerId: spec.id,
        isCapital: index === 0,
        lastPricePaidCents: 1_000 + index * 400,
        isContested: false,
        ownedSince: foundedAt,
        lockedUntil: null,
      }
      // Overwrite the unclaimed placeholder rather than adding a duplicate id.
      if (existingIndex === undefined) hexes.push(owned)
      else hexes[existingIndex] = owned
    })
  }

  return { empires, hexes }
}
