'use client'

import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { MapControls, OrthographicCamera } from '@react-three/drei'
import { clusterHexesByOwner } from '@/lib/hex/clusterHexes'
import { useGameStore } from '@/lib/state/gameStore'
import { requestHoverChange } from '@/lib/state/hoverIntent'
import { EmptyHexField } from './EmptyHexField'
import { BrandHexTile } from './BrandHexTile'
import { SelectionLayer } from './SelectionLayer'
import { PendingClaimLayer } from './PendingClaimLayer'
import { AttackArrowLayer } from './AttackArrowLayer'

const ISO_DISTANCE = 24

/**
 * Camera elevation above the ground plane.
 *
 * NOT true isometric. That is `atan(1/sqrt(2))` = 35.3 degrees, which foreshortens the ground to
 * `sin(35.3) = 58%` of its true height — every tile squashed to well under two-thirds, and every
 * logo on them with it. At 60 degrees the ground renders at `sin(60) = 87%`, so hexes read as
 * hexes and a brand mark stays recognisable, while the prisms keep enough visible side face for
 * the map to read as solid objects rather than a flat board.
 */
export const ISO_TILT = (60 * Math.PI) / 180

/**
 * Yaw is zero: the camera looks straight down the -Z axis rather than along a 45 degree diagonal.
 *
 * With flat-top hexes, a 45 degree yaw rotates the entire lattice diagonally on screen, which
 * fights the eye and tips every logo off-axis. Facing the grid square-on lines the hex rows up
 * horizontally and keeps anything drawn on them upright.
 */
const ISO_POSITION: [number, number, number] = [
  0,
  ISO_DISTANCE * Math.sin(ISO_TILT),
  ISO_DISTANCE * Math.cos(ISO_TILT),
]

export function HexGridCanvas() {
  const ownedHexes = useGameStore((s) => s.ownedHexes)
  const empires = useGameStore((s) => s.empires)
  const toggleHexSelection = useGameStore((s) => s.toggleHexSelection)

  // NOTE: this component deliberately does NOT subscribe to `hoveredHexId` or `selectedHexIds`.
  // Both change on pointer movement; reading them here re-rendered the whole scene each time.
  // SelectionLayer and ConquestCardLayer subscribe to them in isolation instead.

  const ownedClusters = useMemo(() => clusterHexesByOwner(Array.from(ownedHexes.values())), [ownedHexes])

  return (
    <Canvas
      // Capped below 2: at devicePixelRatio 2 this renders 4x the pixels, and both Windows display
      // scaling and every modern phone put it there. 1.75 keeps hex edges crisp for a fraction of
      // the fill cost. (`shadows` is intentionally absent — see the directionalLight comment.)
      dpr={[1, 1.75]}
      className="!fixed inset-0 z-0"
      // The canvas owns pan/zoom gestures outright; without this a drag on a phone also scrolls
      // the page behind it and the map fights the browser for the gesture.
      style={{ touchAction: 'none' }}
    >
      <OrthographicCamera makeDefault position={ISO_POSITION} zoom={40} near={0.1} far={400} />
      <MapControls
        enableRotate={false}
        enableDamping
        dampingFactor={0.12}
        minZoom={15}
        maxZoom={120}
        // Ground-plane panning, not screen-plane: a map should slide under the cursor along the
        // grid, and screen-space panning drifts the orbit target off y=0 as it goes.
        screenSpacePanning={false}
      />

      <ambientLight intensity={0.35} />
      {/*
        No `castShadow`, and no `shadows` on <Canvas>. Nothing in this scene ever set `castShadow`
        on a mesh, so the 2048x2048 shadow pass that ran every single frame rendered an empty depth
        map and produced no visible shadow at all — pure cost. The scene reads off emissive rims
        and ambient fill, so dropping the shadow pass is a straight win with no visual change.
      */}
      <directionalLight position={[15, 25, 10]} intensity={1.1} />
      {/*
        No fog. The map is unbounded now, so a fixed distance-based fade would either swallow tiles
        the camera can plainly see or do nothing at all depending on zoom — and EmptyHexField stops
        generating hexes past the viewport, so there is no far edge left to hide.
      */}
      <color attach="background" args={['#0B0E14']} />

      <EmptyHexField onHoverChange={requestHoverChange} onSelect={toggleHexSelection} />

      {ownedClusters.map((cluster) => {
        const empire = empires.get(cluster.ownerId)
        if (!empire) return null
        return (
          <BrandHexTile
            key={cluster.ownerId}
            cluster={cluster.hexes.map((hex) => hex.coord)}
            empire={empire}
            isContested={cluster.hexes.some((hex) => hex.isContested)}
            onHexHover={requestHoverChange}
          />
        )
      })}

      <SelectionLayer />
      <PendingClaimLayer />
      <AttackArrowLayer />
    </Canvas>
  )
}
