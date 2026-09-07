'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildEdgeRibbonVertices, regionBoundaryEdges } from '@/lib/hex/hexGeometry'
import { HEX_SIZE } from '@/lib/hex/mapConfig'
import type { AxialCoord } from '@/lib/hex/hexMath'

type HexOutlineProps = {
  coords: AxialCoord[]
  color: string
  /** World Y. Must clear the prism tops (0.15 for empty, 0.17 for owned) or the outline z-fights. */
  elevation?: number
  thickness?: number
  opacity?: number
}

/**
 * Draws the perimeter of a set of hexes as a glowing ribbon.
 *
 * Used for both hover (one hex) and selection (any number). Because it outlines the *region*
 * rather than each tile, a run of adjacent selected hexes is enclosed by one continuous border —
 * so a connected block reads as a single territory you are about to buy, and a scattered basket
 * reads as separate pieces, which is the honest picture in both cases.
 */
export function HexOutline({
  coords,
  color,
  elevation = 0.19,
  thickness = 0.09,
  opacity = 1,
}: HexOutlineProps) {
  const geometry = useMemo(() => {
    const vertices = buildEdgeRibbonVertices(regionBoundaryEdges(coords), HEX_SIZE, thickness, elevation)
    const next = new THREE.BufferGeometry()
    next.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
    return next
  }, [coords, thickness, elevation])

  useEffect(() => () => geometry.dispose(), [geometry])

  if (coords.length === 0) return null

  return (
    // `raycast={() => null}`: this sits directly on top of the hexes it describes, so leaving it
    // pickable would put it between the cursor and the tile and swallow every hover and click.
    <mesh geometry={geometry} raycast={() => null} renderOrder={2}>
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        toneMapped={false}
        side={THREE.DoubleSide}
        // Drawn over the prisms rather than intersecting them — the ribbon sits a hair above the
        // tile surface, and depth-testing it against a surface that close produces stitching.
        depthWrite={false}
      />
    </mesh>
  )
}
