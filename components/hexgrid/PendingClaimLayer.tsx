'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { coordFromHexId } from '@/lib/hex/hexIdentity'
import { buildClusterMosaicGeometry, clusterWorldBounds } from '@/lib/hex/hexGeometry'
import { clusterCoordsByAdjacency } from '@/lib/hex/clusterHexes'
import { axialKey } from '@/lib/hex/hexMath'
import { HEX_SIZE } from '@/lib/hex/mapConfig'
import { useGameStore } from '@/lib/state/gameStore'
import { useLogoMosaicTexture } from './useLogoMosaicTexture'
import type { PendingBrand } from '@/lib/state/gameStore'
import type { AxialCoord } from '@/lib/hex/hexMath'

const PREVIEW_OPACITY = 0.7
/** Above the empty prism's top (0.15) and clear of the selection ribbon (0.19-0.21). */
const MOSAIC_ELEVATION = 0.235

/**
 * Shows the buyer's own brand across the tiles they have selected, before they pay.
 *
 * This is the confirmation the flow otherwise lacks: the address they typed resolved to *this*
 * logo, and it will cover *these* tiles at *this* size. Seeing it laid across the actual territory
 * is far more convincing than a thumbnail in a form, and it catches a wrong URL before money moves.
 *
 * Rendered translucent so it reads as a proposal rather than as territory already taken.
 */
export function PendingClaimLayer() {
  const pendingBrand = useGameStore((s) => s.pendingBrand)
  const selectedHexIds = useGameStore((s) => s.selectedHexIds)

  const clusters = useMemo(() => {
    const coords = selectedHexIds
      .map(coordFromHexId)
      .filter((coord): coord is AxialCoord => coord !== null)
    // Grouped by adjacency so a connected block gets one mark spanning the whole block, while
    // scattered picks each get their own — matching how owned territory is drawn.
    return clusterCoordsByAdjacency(coords)
  }, [selectedHexIds])

  if (!pendingBrand || clusters.length === 0) return null

  return (
    <>
      {clusters.map((cluster) => (
        <PendingClusterMark key={cluster.map(axialKey).join('|')} cluster={cluster} brand={pendingBrand} />
      ))}
    </>
  )
}

function PendingClusterMark({ cluster, brand }: { cluster: AxialCoord[]; brand: PendingBrand }) {
  const bounds = useMemo(() => clusterWorldBounds(cluster, HEX_SIZE), [cluster])
  const width = bounds.maxX - bounds.minX
  const depth = bounds.maxZ - bounds.minZ

  const mosaicTexture = useLogoMosaicTexture({
    name: brand.domain,
    domain: brand.domain,
    // The selection colour, so a preview never reads as a settled claim.
    colorHex: '#00FF87',
    logoUrl: brand.logoUrl,
    aspect: depth > 0 ? width / depth : 1,
  })

  const mosaicGeometry = useMemo(() => {
    const { positions, uvs } = buildClusterMosaicGeometry(cluster, HEX_SIZE, MOSAIC_ELEVATION, bounds)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    return geometry
  }, [cluster, bounds])
  useEffect(() => () => mosaicGeometry.dispose(), [mosaicGeometry])

  return (
    <group>
      <mesh geometry={mosaicGeometry} raycast={() => null} renderOrder={2}>
        <meshBasicMaterial
          map={mosaicTexture}
          transparent
          opacity={PREVIEW_OPACITY}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}
