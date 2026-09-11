'use client'

import { memo, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { useLogoMosaicTexture } from './useLogoMosaicTexture'
import { axialToPixel, type AxialCoord } from '@/lib/hex/hexMath'
import { buildClusterMosaicGeometry, clusterWorldBounds } from '@/lib/hex/hexGeometry'
import { focusForCluster } from '@/lib/hex/clusterFootprint'
import { hexIdFor } from '@/lib/hex/hexIdentity'
// Single source of truth, not a local copy — see lib/hex/mapConfig.ts.
import { HEX_SIZE } from '@/lib/hex/mapConfig'
import type { Empire } from '@/types/game'

const PRISM_HEIGHT = 0.34
const FLAT_TOP_ROTATION = Math.PI / 6
/** Just above the prism tops (0.17), low enough that the mark reads as painted onto the tiles. */
const MOSAIC_ELEVATION = 0.185

const CONTESTED_COLOR = '#FF3366'

type BrandHexTileProps = {
  /** A contiguous same-owner cluster (see lib/hex/hexMath.ts floodFillCluster). */
  cluster: AxialCoord[]
  /**
   * The cluster's exact tile set as a stable string. `cluster` is a new array on every map update,
   * so memo compares this instead — an untouched territory then skips rendering entirely, rather
   * than rebuilding its geometry and redrawing its logo texture because a neighbour changed.
   */
  signature: string
  empire: Empire
  isContested: boolean
  onHexHover: (hexId: string | null) => void
}

/**
 * One empire's contiguous territory: brand-coloured prisms with the logo projected across all of
 * them.
 *
 * Two always-on layers, because ownership has to be legible at two different distances:
 *
 *  1. **Tile colour** — readable at any zoom, well past the point where an image resolves.
 *     Territory borders show up as colour boundaries, the way they do on an election map.
 *  2. **The mosaic** — the logo UV-projected across the whole cluster, so a twenty-hex empire
 *     displays its mark twenty hexes wide instead of on a single tile. The hexes stay visible
 *     through it, so the territory still reads as a grid rather than a printed sheet.
 *
 * Nothing floats above the tiles. An upright billboard card was tried here and removed: at this
 * camera's 35 degree tilt, "above a hex" on screen is exactly where its neighbours are, so a
 * floating card covers the very tiles a buyer is trying to click. The hover card (HexTooltip)
 * carries the readable text instead, and it is click-through for the same reason.
 *
 * Clicking one of these tiles always opens the owner's site — see the pointerUp handler. Taking
 * territory from them is done through the attack arrows, which appear only on occupied ground
 * because that is the only place a click would otherwise be ambiguous.
 */
function BrandHexTileImpl({ cluster, empire, isContested, onHexHover }: BrandHexTileProps) {
  const pressRef = useRef<{ x: number; y: number } | null>(null)

  const centers = useMemo(
    () => cluster.map((coord) => ({ coord, pixel: axialToPixel(coord, HEX_SIZE) })),
    [cluster],
  )

  const bounds = useMemo(() => clusterWorldBounds(cluster, HEX_SIZE), [cluster])
  const territoryWidth = bounds.maxX - bounds.minX
  const territoryDepth = bounds.maxZ - bounds.minZ

  // The mark spans the whole territory, so its shape is the territory's shape.
  // `detail` gates how much the territory can carry: the mark alone on a single hex, the domain
  // beneath it once there is room, and the scraped description under that on a large holding.
  const placement = useMemo(() => focusForCluster(cluster, bounds), [cluster, bounds])

  const mosaicTexture = useLogoMosaicTexture({
    name: empire.name,
    domain: empire.domain,
    title: empire.ogTitle,
    description: empire.ogDescription,
    colorHex: empire.primaryColorHex,
    logoUrl: empire.logoUrl,
    aspect: territoryDepth > 0 ? territoryWidth / territoryDepth : 1,
    detail: placement.detail,
    focus: placement.focus,
    tileCount: cluster.length,
  })

  const mosaicGeometry = useMemo(() => {
    const { positions, uvs } = buildClusterMosaicGeometry(cluster, HEX_SIZE, MOSAIC_ELEVATION, bounds)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    return geometry
  }, [cluster, bounds])
  useEffect(() => () => mosaicGeometry.dispose(), [mosaicGeometry])

  const tileColor = useMemo(
    () => new THREE.Color(isContested ? CONTESTED_COLOR : empire.primaryColorHex),
    [isContested, empire.primaryColorHex],
  )

  const prismGeometry = useMemo(
    () => new THREE.CylinderGeometry(HEX_SIZE * 0.96, HEX_SIZE * 0.96, PRISM_HEIGHT, 6),
    [],
  )
  useEffect(() => () => prismGeometry.dispose(), [prismGeometry])

  return (
    <group>
      {centers.map(({ coord, pixel }) => {
        const hexId = hexIdFor(coord)
        return (
          <mesh
            key={hexId}
            geometry={prismGeometry}
            position={[pixel.x, 0, pixel.z]}
            rotation={[0, FLAT_TOP_ROTATION, 0]}
            onPointerOver={(event: ThreeEvent<PointerEvent>) => {
              event.stopPropagation()
              onHexHover(hexId)
            }}
            onPointerOut={(event: ThreeEvent<PointerEvent>) => {
              event.stopPropagation()
              onHexHover(null) // deferred by hoverIntent's grace period, not applied immediately
            }}
            onPointerDown={(event: ThreeEvent<PointerEvent>) => {
              pressRef.current = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY }
            }}
            onPointerUp={(event: ThreeEvent<PointerEvent>) => {
              // Same deterministic tap detection as EmptyHexField — R3F's synthesized click drops
              // the first interaction when MapControls shares the canvas.
              const press = pressRef.current
              pressRef.current = null
              if (!press) return
              if (
                Math.abs(event.nativeEvent.clientX - press.x) > 5 ||
                Math.abs(event.nativeEvent.clientY - press.y) > 5
              ) {
                return // camera pan, not a tap
              }
              event.stopPropagation()

              // A click on somebody else's territory ALWAYS opens their site. That click is the
              // product they bought, and it now has exactly one meaning everywhere on the map.
              // Taking the tile is the attack arrow's job (AttackArrowLayer) — a separate target,
              // so nothing has to be remembered or toggled to get the right outcome.
              //
              // noopener/noreferrer matter here specifically: the destination is arbitrary,
              // buyer-controlled, untrusted content, and without them it could reach back through
              // window.opener and redirect the game tab.
              window.open(empire.url, '_blank', 'noopener,noreferrer')
            }}
            onContextMenu={(event: ThreeEvent<MouseEvent>) => {
              // Right-click as a hover fallback for touch/no-hover devices, per spec.
              event.stopPropagation()
              event.nativeEvent.preventDefault()
              onHexHover(hexId)
            }}
          >
            {/*
              The brand colour IS the tile, not a tint over a dark base. Ownership then survives any
              zoom level — whose territory is whose is legible long before a logo resolves.
            */}
            <meshStandardMaterial
              color={tileColor}
              metalness={0.15}
              roughness={0.55}
              emissive={tileColor}
              emissiveIntensity={isContested ? 0.55 : 0.22}
            />
          </mesh>
        )
      })}

      {/* The mark, spread across every hex the empire owns. */}
      <mesh geometry={mosaicGeometry} raycast={() => null} renderOrder={1}>
        <meshBasicMaterial
          map={mosaicTexture}
          transparent
          toneMapped={false}
          // Drawn over the tiles rather than intersecting them: it sits a hair above the surface,
          // and depth-writing at that distance produces z-fighting speckle.
          depthWrite={false}
        />
      </mesh>

    </group>
  )
}

/**
 * Memoized: the parent re-renders on any store change, but a cluster's rendered output depends
 * only on the props below. Without this, unrelated updates walked every hex mesh in every empire.
 */
export const BrandHexTile = memo(
  BrandHexTileImpl,
  (previous, next) =>
    previous.signature === next.signature &&
    previous.empire === next.empire &&
    previous.isContested === next.isContested &&
    previous.onHexHover === next.onHexHover,
)
