'use client'

import { useMemo, useState } from 'react'
import { Trophy, BarChart3, HelpCircle, ChevronDown } from 'lucide-react'
import { useGameStore, selectOwnerAt } from '@/lib/state/gameStore'
import { resolveHexById } from '@/lib/hex/hexIdentity'
import { priceForSelection, nextTileCostCents, PROTECTION_FEE_CENTS } from '@/lib/pricing/takeoverPricing'
import { checkSelectionEligibility, countDisconnectedGroups } from '@/lib/hex/selectionEligibility'
import { ELIGIBILITY_MESSAGES } from '@/lib/hex/territoryEligibility'
import { axialKey } from '@/lib/hex/hexMath'
import { ClaimBar } from '@/components/claim/ClaimBar'
import { HallOfFamePanel, type HallOfFameEntry } from './HallOfFamePanel'
import { HowItWorksPanel } from './HowItWorksPanel'
import { MarketDataPanel } from './MarketDataPanel'

type BottomDashboardProps = {
  hallOfFameEntries: HallOfFameEntry[]
  onConquer: (input: { hexIds: string[]; url: string; protect: boolean; agreedToTerms: true }) => Promise<void>
}

type PanelKey = 'leaderboard' | 'market' | 'help'

const PANEL_TABS: Array<{ key: PanelKey; label: string; icon: typeof Trophy }> = [
  { key: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  { key: 'market', label: 'Market', icon: BarChart3 },
  { key: 'help', label: 'How it works', icon: HelpCircle },
]

/**
 * The bottom of the screen: the claim bar, plus reference panels behind a tab strip.
 *
 * Previously four panels sat permanently across the bottom in a fixed 4-column grid, which on a
 * phone stacked into a column taller than the viewport and buried the one control that matters
 * under a leaderboard. Now the claim bar is always visible and everything else is opt-in, which
 * also means the map — the actual product — keeps most of the screen at every size.
 */
export function BottomDashboard({ hallOfFameEntries, onConquer }: BottomDashboardProps) {
  const selectedHexIds = useGameStore((s) => s.selectedHexIds)
  const clearSelection = useGameStore((s) => s.clearSelection)
  const ownedHexes = useGameStore((s) => s.ownedHexes)
  const market = useGameStore((s) => s.market)
  const myEmpireId = useGameStore((s) => s.myEmpireId)
  const [protect, setProtect] = useState(false)
  const [openPanel, setOpenPanel] = useState<PanelKey | null>(null)

  const selectedHexes = useMemo(
    () =>
      selectedHexIds
        .map((id) => resolveHexById(ownedHexes, id))
        .filter((hex): hex is NonNullable<typeof hex> => hex !== null),
    [selectedHexIds, ownedHexes],
  )

  /**
   * Each selected hex re-checked against owned territory plus the rest of the basket, so a chain
   * built outward stays valid. Per hex rather than one pass/fail, because with a multi-hex basket
   * "something is unreachable" is useless without saying how much.
   */
  /**
   * Separate patches of map this claim covers. Each is its own billboard and each is charged for —
   * scattering is allowed, it just isn't free. See lib/pricing/takeoverPricing.ts.
   */
  const billboardCount = useMemo(
    () => countDisconnectedGroups(selectedHexes.map((hex) => hex.coord)),
    [selectedHexes],
  )

  /** Only tiles buried inside a rival's territory are refused — you fight to a border first. */
  const blockedReason = useMemo(() => {
    if (selectedHexes.length === 0) return null
    const allKeys = new Set(selectedHexes.map((hex) => axialKey(hex.coord)))
    const unreachable = selectedHexes.filter((hex) => {
      // Checked against the basket *minus itself* — a tile can't be its own route in.
      const others = new Set(allKeys)
      others.delete(axialKey(hex.coord))
      return !checkSelectionEligibility(
        hex.coord,
        (coord) => selectOwnerAt({ ownedHexes }, coord),
        myEmpireId,
        { selectedKeys: others, targetOwnerId: hex.ownerId },
      ).eligible
    })
    if (unreachable.length === 0) return null
    return `${unreachable.length} tile${unreachable.length === 1 ? '' : 's'} — ${ELIGIBILITY_MESSAGES.blocked}`
  }, [selectedHexes, ownedHexes, myEmpireId])

  // The SAME function the server charges with, so the previewed total and the amount taken can
  // never disagree.
  const price = useMemo(
    () => priceForSelection(selectedHexes, billboardCount),
    [selectedHexes, billboardCount],
  )
  const nextTileCents = nextTileCostCents(selectedHexes.length)

  const totalCents =
    selectedHexes.length > 0 && !blockedReason
      ? price.totalCents + (protect ? PROTECTION_FEE_CENTS * selectedHexes.length : 0)
      : null

  async function handleClaim({ url, agreedToTerms }: { url: string; agreedToTerms: true }) {
    if (selectedHexes.length === 0) throw new Error('Tap tiles on the map to select them first')
    if (blockedReason) throw new Error(blockedReason)
    await onConquer({ hexIds: selectedHexes.map((hex) => hex.id), url, protect, agreedToTerms })
  }

  const ActivePanel =
    openPanel === 'leaderboard' ? (
      <HallOfFamePanel entries={hallOfFameEntries} />
    ) : openPanel === 'market' ? (
      <MarketDataPanel snapshot={market} />
    ) : openPanel === 'help' ? (
      <HowItWorksPanel />
    ) : null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 p-2 sm:p-4">
      {/* Expanded reference panel, above the bar so the bar never moves when it opens. Height is
          viewport-relative so it can't push the claim bar off a short screen. */}
      {ActivePanel && (
        <div className="pointer-events-auto h-[38svh] w-full max-w-3xl sm:h-56">{ActivePanel}</div>
      )}

      {/* Inert itself: only the tab buttons and the claim bar take clicks. On a phone this column is
          the full viewport width, and when it captured pointer events the empty space either side
          of the centred tabs was a strip of map that could never be tapped. */}
      <div className="pointer-events-none flex w-full max-w-3xl flex-col gap-2">
        <div className="flex flex-wrap justify-center gap-1.5">
          {PANEL_TABS.map(({ key, label, icon: Icon }) => {
            const isOpen = openPanel === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setOpenPanel(isOpen ? null : key)}
                aria-expanded={isOpen}
                className={`pointer-events-auto flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium backdrop-blur-hud transition-colors ${
                  isOpen
                    ? 'border-hexwars-cyan/40 bg-hexwars-cyan/10 text-hexwars-cyan'
                    : 'border-glass-border bg-glass text-white/55 hover:text-white/80'
                }`}
              >
                <Icon size={12} />
                {label}
                {isOpen && <ChevronDown size={12} />}
              </button>
            )
          })}
        </div>

        <ClaimBar
          selectedCount={selectedHexes.length}
          totalCents={totalCents}
          escalationCents={price.escalationCents}
          spreadCents={price.spreadCents}
          billboardCount={price.billboardCount}
          nextTileCents={nextTileCents}
          blockedReason={blockedReason}
          protect={protect}
          onProtectChange={setProtect}
          onClearSelection={clearSelection}
          onClaim={handleClaim}
        />
      </div>
    </div>
  )
}
