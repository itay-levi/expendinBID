'use client'

import { useMemo, useRef } from 'react'
import { Html } from '@react-three/drei'
import { axialToPixel, axialKey } from '@/lib/hex/hexMath'
import { coordFromHexId } from '@/lib/hex/hexIdentity'
import { HEX_SIZE } from '@/lib/hex/mapConfig'
import { checkSelectionEligibility } from '@/lib/hex/selectionEligibility'
import { useGameStore, selectHexById, selectOwnerAt } from '@/lib/state/gameStore'
import { useLiveVisitors } from '@/lib/analytics/useLiveVisitors'
import { ConquestCard } from './HexTooltip'

/**
 * Owns the hovered-hex Conquest Card, deliberately split out of HexGridCanvas.
 *
 * Hover state changes on nearly every pointer move. When HexGridCanvas subscribed to
 * `hoveredHexId` itself, each of those re-rendered the entire scene subtree — the 469-instance
 * EmptyHexField and every BrandHexTile — just to move a DOM card. Subscribing here instead means
 * a hover re-renders only this component, and the grid's React tree stays untouched.
 *
 * `useLiveVisitors` (a 15s poll) lives here for the same reason: it is only ever read by the card.
 */
export function ConquestCardLayer() {
  const hoveredHexId = useGameStore((s) => s.hoveredHexId)
  const ownedHexes = useGameStore((s) => s.ownedHexes)
  const empires = useGameStore((s) => s.empires)
  const myEmpireId = useGameStore((s) => s.myEmpireId)
  const mapMode = useGameStore((s) => s.mapMode)
  const selectedHexIds = useGameStore((s) => s.selectedHexIds)
  const liveVisitors = useLiveVisitors()

  const hoveredHex = hoveredHexId ? selectHexById({ ownedHexes }, hoveredHexId) : null

  // Last hovered position, kept so the (permanently mounted, see below) <Html> has somewhere to
  // sit while nothing is hovered. It's empty then, so the exact spot is immaterial.
  const anchorRef = useRef({ x: 0, z: 0 })
  if (hoveredHex) anchorRef.current = axialToPixel(hoveredHex.coord, HEX_SIZE)
  const anchor = anchorRef.current

  const owner = hoveredHex?.ownerId ? empires.get(hoveredHex.ownerId) ?? null : null

  // Civilization-style rule (ARCHITECTURE.md §23): only reachable from your own border, or free
  // if genuinely unclaimed. This is a UX preview only — the server re-derives and enforces it
  // independently from the submitted URL at checkout time, never trusting this client-side value.
  // Evaluated against the basket as well as owned territory, so the card agrees with the map's
  // own highlight and with what the Buy & Conquer panel will accept.
  const selectedKeys = useMemo(
    () =>
      new Set(
        selectedHexIds
          .map(coordFromHexId)
          .filter((coord): coord is NonNullable<typeof coord> => coord !== null)
          .map(axialKey),
      ),
    [selectedHexIds],
  )

  const eligibility = hoveredHex
    ? checkSelectionEligibility(
        hoveredHex.coord,
        (coord) => selectOwnerAt({ ownedHexes }, coord),
        myEmpireId,
        selectedKeys,
      )
    : null

  return (
    <Html
      position={[anchor.x, 0.65, anchor.z]}
      center
      // NO `distanceFactor`, and NO `occlude` — both are actively harmful under this scene's
      // OrthographicCamera, and together they caused the "giant red strip + everything crawls" bug:
      //
      //   * `distanceFactor` scales the card by drei's `objectScale()`, which for an orthographic
      //     camera returns `camera.zoom` verbatim (40 here, up to MapControls' maxZoom of 120).
      //     `distanceFactor={8}` therefore meant `scale(320)` — a 224px card rendered ~72,000px
      //     wide, so its coral "blocked" bar became a red band across the whole viewport and its
      //     backdrop-blur forced a full-screen backdrop-filter recomposite on every pointer move.
      //     A HUD card should read at a constant size anyway: an ortho camera has no perspective
      //     foreshortening for it to compensate for.
      //   * `occlude` (raycast mode) runs `raycaster.intersectObjects([scene], true)` — against the
      //     whole 469-instance grid — every frame the card moves, and toggles the element's
      //     `display` between block/none, which is what made the card flicker in and out.
      zIndexRange={[40, 0]}
      // The wrapper must NOT take pointer events: <Html center> anchors it on the hovered hex, so
      // an interactive wrapper sits directly under the cursor and swallows the click meant for
      // the hex (verified in a real browser — hovering worked, clicking did nothing). Only the
      // card itself is interactive, and it's offset upward so it clears the hex it describes.
      style={{ pointerEvents: 'none' }}
    >
      {/*
        Rendered as empty children rather than by unmounting the <Html> itself. drei's Html spins
        up its own container element and a separate ReactDOM root on mount and tears both down on
        unmount; conditionally rendering it meant sweeping the pointer across the grid built and
        destroyed a React root — and a fresh backdrop-filter compositing layer — for every hex
        crossed, which reads as the card flickering. Keeping the host mounted makes a hover change
        an ordinary re-render of its contents.
      */}
      {hoveredHex && eligibility && (
        <ConquestCard
          hex={hoveredHex}
          owner={owner}
          liveVisitors={liveVisitors}
          eligibility={eligibility}
          isSelected={hoveredHex ? selectedHexIds.includes(hoveredHex.id) : false}
          mapMode={mapMode}
        />
      )}
    </Html>
  )
}
