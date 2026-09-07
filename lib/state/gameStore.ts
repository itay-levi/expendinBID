import { create } from 'zustand'
import { hexIdFor, resolveHexAt, resolveHexById } from '@/lib/hex/hexIdentity'
import type { AxialCoord } from '@/lib/hex/hexMath'
import type { Empire, HexTile, MarketSnapshot, TakeoverEvent } from '@/types/game'

/** The brand a visitor is about to plant, resolved from their URL before they pay. */
export type PendingBrand = {
  url: string
  domain: string
  title: string
  description: string
  logoUrl: string
}

type GameState = {
  /**
   * ONLY hexes somebody owns.
   *
   * Unclaimed hexes are derived from their coordinates (lib/hex/hexIdentity.ts), never stored.
   * That is what makes the map unbounded: this map's size tracks how much has been sold, not how
   * big the world is, so panning forever costs nothing and the grid can never run out of tiles.
   */
  ownedHexes: Map<string, HexTile>
  empires: Map<string, Empire>
  recentEvents: TakeoverEvent[]
  market: MarketSnapshot
  hoveredHexId: string | null
  /** The buyer's basket, in click order. The first pick becomes their capital. */
  selectedHexIds: string[]
  /** Brand resolved from the URL in the claim bar, previewed on selected hexes before payment. */
  pendingBrand: PendingBrand | null
  myEmpireId: string | null
}

type GameActions = {
  setHoveredHex: (hexId: string | null) => void
  toggleHexSelection: (hexId: string) => void
  clearSelection: () => void
  setPendingBrand: (brand: PendingBrand | null) => void
  applyHexUpdate: (hex: HexTile) => void
  applyEmpireUpsert: (empire: Empire) => void
  applyTakeoverEvent: (event: TakeoverEvent) => void
  applyMarketSnapshot: (snapshot: MarketSnapshot) => void
  isUnderAttack: (empireId: string) => boolean
  /**
   * Optimistic client-side identity, set locally the moment a visitor submits their first URL —
   * before payment confirms, so hover/select previews (territoryEligibility.ts) can show accurate
   * adjacency feedback right away. This is a UX convenience, never a trust boundary: the server
   * independently derives the acquiring empire from the submitted URL on every checkout request
   * (see app/api/checkout/create-session/route.ts) rather than trusting this value.
   * NOTE: there is no real session/auth system yet, so this resets on page reload — see
   * ARCHITECTURE.md §23 for the open question this leaves.
   */
  setMyEmpireId: (empireId: string | null) => void
  /** Bulk-load map state in one update (demo seed today; the realtime snapshot event later). */
  loadSnapshot: (snapshot: { empires: Empire[]; hexes: HexTile[]; market?: MarketSnapshot }) => void
}

const initialMarket: MarketSnapshot = {
  totalWarRevenueCents: 0,
  activeConflicts: 0,
  globalMarketCapCents: 0,
  totalTakeoverEvents: 0,
  avgRevenuePerTakeoverCents: 0,
  avgControlDurationSeconds: 0,
}

/** True for a hex worth persisting — anything else is indistinguishable from open ground. */
function isWorthStoring(hex: HexTile): boolean {
  return hex.ownerId !== null || hex.lockedUntil !== null || hex.isContested
}

// Immutable updates throughout: every action replaces the Map with a new one rather than
// mutating in place, so React/zustand subscribers always see a distinct reference on change.
export const useGameStore = create<GameState & GameActions>((set, get) => ({
  ownedHexes: new Map(),
  empires: new Map(),
  recentEvents: [],
  market: initialMarket,
  hoveredHexId: null,
  selectedHexIds: [],
  pendingBrand: null,
  myEmpireId: null,

  setHoveredHex: (hexId) => set({ hoveredHexId: hexId }),

  toggleHexSelection: (hexId) =>
    set((state) => ({
      selectedHexIds: state.selectedHexIds.includes(hexId)
        ? state.selectedHexIds.filter((id) => id !== hexId)
        : [...state.selectedHexIds, hexId],
    })),

  clearSelection: () => set({ selectedHexIds: [] }),

  setPendingBrand: (brand) => set({ pendingBrand: brand }),

  applyHexUpdate: (hex) =>
    set((state) => {
      const next = new Map(state.ownedHexes)
      // A hex reverting to open ground is deleted rather than stored as an empty row — otherwise
      // abandoned tiles accumulate forever and the "only store what's sold" invariant erodes.
      if (isWorthStoring(hex)) next.set(hex.id, hex)
      else next.delete(hex.id)
      return { ownedHexes: next }
    }),

  applyEmpireUpsert: (empire) =>
    set((state) => {
      const next = new Map(state.empires)
      next.set(empire.id, empire)
      return { empires: next }
    }),

  applyTakeoverEvent: (event) =>
    set((state) => ({
      recentEvents: [event, ...state.recentEvents].slice(0, 50),
    })),

  applyMarketSnapshot: (snapshot) => set({ market: snapshot }),

  isUnderAttack: (empireId) => {
    for (const hex of get().ownedHexes.values()) {
      if (hex.ownerId === empireId && hex.isContested) return true
    }
    return false
  },

  setMyEmpireId: (empireId) => set({ myEmpireId: empireId }),

  loadSnapshot: ({ empires, hexes, market }) =>
    set((state) => ({
      empires: new Map(empires.map((empire) => [empire.id, empire])),
      ownedHexes: new Map(hexes.filter(isWorthStoring).map((hex) => [hex.id, hex])),
      market: market ?? state.market,
      // The basket is deliberately PRESERVED. This runs on every poll of /api/map, so clearing it
      // here wiped the buyer's selection every few seconds mid-flow. Nothing needs clearing: prices
      // and eligibility are re-derived from the incoming hexes on render, so a selection whose
      // tiles changed hands simply re-prices itself. It is cleared on a completed claim instead.
    })),
}))

/**
 * The hex at a coordinate — the stored row if it's owned, otherwise the derived unclaimed tile.
 *
 * Callers must go through this rather than reading `ownedHexes` directly, or every unclaimed hex
 * on the map reads as "does not exist" and hover, pricing and selection all silently no-op on the
 * overwhelming majority of the grid.
 */
export function selectHexAt(state: Pick<GameState, 'ownedHexes'>, coord: AxialCoord): HexTile {
  return resolveHexAt(state.ownedHexes, coord)
}

/** As `selectHexAt`, from an id. Null only when the id is malformed. */
export function selectHexById(state: Pick<GameState, 'ownedHexes'>, hexId: string): HexTile | null {
  return resolveHexById(state.ownedHexes, hexId)
}

/** The owner of a coordinate, or null for open ground. The lookup adjacency rules are built on. */
export function selectOwnerAt(state: Pick<GameState, 'ownedHexes'>, coord: AxialCoord): string | null {
  return state.ownedHexes.get(hexIdFor(coord))?.ownerId ?? null
}

/** True when this empire holds at least one tile — gates the one free placement. */
export function selectHasTerritory(
  state: Pick<GameState, 'ownedHexes'>,
  empireId: string | null,
): boolean {
  if (!empireId) return false
  for (const hex of state.ownedHexes.values()) {
    if (hex.ownerId === empireId) return true
  }
  return false
}
