'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { coordFromHexId } from '@/lib/hex/hexIdentity'
import { buildClusterMosaicGeometry, clusterWorldBounds } from '@/lib/hex/hexGeometry'
import { clusterCoordsByAdjacency } from '@/lib/hex/clusterHexes'
import { focusForCluster } from '@/lib/hex/clusterFootprint'
import { axialKey, axialToPixel } from '@/lib/hex/hexMath'
import { HEX_SIZE } from '@/lib/hex/mapConfig'
import { useGameStore } from '@/lib/state/gameStore'
import { useLogoMosaicTexture } from './useLogoMosaicTexture'
import type { PendingBrand } from '@/lib/state/gameStore'
import type { AxialCoord } from '@/lib/hex/hexMath'

/**
 * Pending tiles are RAISED above everything under them, and opaque.
 *
 * The height is what makes this a preview rather than a blend. An owned prism tops out at 0.17 with
 * its mosaic at 0.185; sitting above both means the previous owner's colour and logo are physically
 * hidden on these tiles instead of showing through. It also reads as the ground lifting, which says
 * "in play".
 */
const PENDING_PRISM_HEIGHT = 0.46
const PENDING_PRISM_CENTER = 0.03
const PENDING_MOSAIC_ELEVATION = 0.28
const FLAT_TOP_ROTATION = Math.PI / 6

/** Deliberately drab, so an unfilled tile never reads as a finished result. */
const PLACEHOLDER_COLOR = '#3A3550'

/**
 * Stand-in shown on selected tiles before a URL has been entered.
 *
 * Its whole job is to make the first click land. Previously this layer rendered nothing without a
 * brand, so clicking a tile appeared to do nothing at all — the silent failure that made people
 * think the map was broken. A billboard reading "YOUR LOGO HERE" explains the product faster than
 * any copy could, and states plainly what is still missing.
 */
const PLACEHOLDER_BRAND: PendingBrand = {
  url: '',
  domain: 'YOUR LOGO HERE',
  title: '',
  description: '',
  logoUrl: '',
  primaryColorHex: PLACEHOLDER_COLOR,
}

/**
 * What the buyer is about to own, drawn as though they already own it.
 *
 * This used to ghost the buyer's mark at 70% opacity over whatever was already there, so a single
 * tile could show three brands at once — the current owner's fill, their logo, and the buyer's mark
 * on top. Nobody can answer "what am I paying $3,000 for?" from that, because a takeover is not a
 * blend of two brands. It is a replacement.
 *
 * So selected tiles render fully as theirs: their colour, their logo, opaque, covering the previous
 * owner completely. The only thing marking it unpaid is the selection ring SelectionLayer draws
 * above. What you see is what you get.
 */
export function PendingClaimLayer() {
  const pendingBrand = useGameStore((s) => s.pendingBrand)
  const selectedHexIds = useGameStore((s) => s.selectedHexIds)

  const coords = useMemo(
    () => selectedHexIds.map(coordFromHexId).filter((coord): coord is AxialCoord => coord !== null),
    [selectedHexIds],
  )

  // Grouped by adjacency so a connected block gets one mark spanning the whole block, while
  // scattered picks each get their own — matching how owned territory is drawn.
  const clusters = useMemo(() => clusterCoordsByAdjacency(coords), [coords])

  const brand = pendingBrand ?? PLACEHOLDER_BRAND

  const prismGeometry = useMemo(
    () => new THREE.CylinderGeometry(HEX_SIZE * 0.96, HEX_SIZE * 0.96, PENDING_PRISM_HEIGHT, 6),
    [],
  )
  useEffect(() => () => prismGeometry.dispose(), [prismGeometry])

  const tileColor = useMemo(() => new THREE.Color(brand.primaryColorHex), [brand.primaryColorHex])

  // Renders with or WITHOUT a resolved brand — the placeholder covers the latter.
  if (coords.length === 0) return null

  return (
    <>
      {/*
        Opaque prisms in the buyer's own colour, tall enough to bury whatever was underneath.
        `raycast` is disabled so these never intercept a click meant for the tile — selection and
        attack targeting still belong to the layers below.
      */}
      {coords.map((coord) => {
        const pixel = axialToPixel(coord, HEX_SIZE)
        return (
          <mesh
            key={axialKey(coord)}
            geometry={prismGeometry}
            position={[pixel.x, PENDING_PRISM_CENTER, pixel.z]}
            rotation={[0, FLAT_TOP_ROTATION, 0]}
            raycast={() => null}
            renderOrder={2}
          >
            <meshStandardMaterial
              color={tileColor}
              metalness={0.15}
              roughness={0.5}
              emissive={tileColor}
              emissiveIntensity={pendingBrand ? 0.3 : 0.1}
            />
          </mesh>
        )
      })}

      {clusters.map((cluster) => (
        <PendingClusterMark key={cluster.map(axialKey).join('|')} cluster={cluster} brand={brand} />
      ))}
    </>
  )
}

function PendingClusterMark({ cluster, brand }: { cluster: AxialCoord[]; brand: PendingBrand }) {
  const bounds = useMemo(() => clusterWorldBounds(cluster, HEX_SIZE), [cluster])
  const width = bounds.maxX - bounds.minX
  const depth = bounds.maxZ - bounds.minZ
  const placement = useMemo(() => focusForCluster(cluster, bounds), [cluster, bounds])

  const mosaicTexture = useLogoMosaicTexture({
    name: brand.domain,
    domain: brand.domain,
    title: brand.title,
    description: brand.description,
    // Their real colour, sampled from their own logo. A preview in a colour they will not get is
    // not answering the question being asked.
    colorHex: brand.primaryColorHex,
    logoUrl: brand.logoUrl,
    aspect: depth > 0 ? width / depth : 1,
    detail: placement.detail,
    focus: placement.focus,
    tileCount: cluster.length,
  })

  const mosaicGeometry = useMemo(() => {
    const { positions, uvs } = buildClusterMosaicGeometry(cluster, HEX_SIZE, PENDING_MOSAIC_ELEVATION, bounds)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    return geometry
  }, [cluster, bounds])
  useEffect(() => () => mosaicGeometry.dispose(), [mosaicGeometry])

  return (
    <mesh geometry={mosaicGeometry} raycast={() => null} renderOrder={3}>
      {/* Full opacity, unlike the old ghost: this is what the tile will look like. */}
      <meshBasicMaterial map={mosaicTexture} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  )
}
