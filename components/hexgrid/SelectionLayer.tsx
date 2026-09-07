'use client'

import { useMemo } from 'react'
import { axialKey } from '@/lib/hex/hexMath'
import { coordFromHexId } from '@/lib/hex/hexIdentity'
import { checkSelectionEligibility } from '@/lib/hex/selectionEligibility'
import { useGameStore, selectOwnerAt } from '@/lib/state/gameStore'
import { HexOutline } from './HexOutline'

const HOVER_CYAN = '#00F0FF'
const BLOCKED_CORAL = '#FF3366'
const SELECTED_GREEN = '#00FF87'

/**
 * The two highlight rings: which hex the pointer is on, and what is currently in the basket.
 *
 * Kept out of HexGridCanvas for the same reason ConquestCardLayer is — both pieces of state change
 * on pointer movement, and reading them in the canvas component re-rendered the whole scene
 * (469-instance grid included) on every hover.
 */
export function SelectionLayer() {
  const hoveredHexId = useGameStore((s) => s.hoveredHexId)
  const selectedHexIds = useGameStore((s) => s.selectedHexIds)
  const ownedHexes = useGameStore((s) => s.ownedHexes)
  const myEmpireId = useGameStore((s) => s.myEmpireId)

  // Derived from the ids themselves, not from a stored row: most selected hexes are unclaimed and
  // therefore have no row at all (see lib/hex/hexIdentity.ts).
  const selectedCoords = useMemo(
    () =>
      selectedHexIds
        .map(coordFromHexId)
        .filter((coord): coord is NonNullable<typeof coord> => coord !== null),
    [selectedHexIds],
  )

  const selectedKeys = useMemo(() => new Set(selectedCoords.map(axialKey)), [selectedCoords])

  const hoveredCoords = useMemo(() => {
    const coord = hoveredHexId ? coordFromHexId(hoveredHexId) : null
    return coord ? [coord] : []
  }, [hoveredHexId])

  // Colour carries the answer to "can I actually take this?" before the card even opens, so the
  // grid itself is readable while panning without stopping to read text.
  const hoveredCoord = hoveredCoords[0]
  const hoverColor = useMemo(() => {
    if (!hoveredCoord) return HOVER_CYAN
    if (selectedKeys.has(axialKey(hoveredCoord))) return SELECTED_GREEN
    const eligibility = checkSelectionEligibility(
      hoveredCoord,
      (coord) => selectOwnerAt({ ownedHexes }, coord),
      myEmpireId,
      { selectedKeys },
    )
    return eligibility.eligible ? HOVER_CYAN : BLOCKED_CORAL
  }, [hoveredCoord, ownedHexes, myEmpireId, selectedKeys])

  return (
    <>
      {/* Selection sits lower and thicker; hover rides just above it so both stay visible when the
          pointer is over an already-selected hex. */}
      <HexOutline coords={selectedCoords} color={SELECTED_GREEN} elevation={0.19} thickness={0.11} />
      <HexOutline coords={hoveredCoords} color={hoverColor} elevation={0.21} thickness={0.07} opacity={0.95} />
    </>
  )
}
