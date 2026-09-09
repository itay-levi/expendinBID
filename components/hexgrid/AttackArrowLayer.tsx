'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { type AttackArrow } from '@/lib/hex/attackArrows'
import { selectAttackArrows } from '@/lib/hex/attackArrowSelector'
import { hexIdFor, resolveHexAt } from '@/lib/hex/hexIdentity'
import { formatCents, requiredPriceForHex } from '@/lib/pricing/takeoverPricing'
import { useGameStore } from '@/lib/state/gameStore'

/** Above the owned prism tops (0.17) and clear of the selection ribbon (0.19-0.21). */
const ARROW_ELEVATION = 0.3
/**
 * On-screen size the arrow holds at every zoom level.
 *
 * Fixed in PIXELS, not world units. An arrow sits on the seam between two tiles, so in world terms
 * it is smaller than a tile by construction — at the minimum zoom a world-sized arrow would render
 * around 8px, well under the ~44px a finger needs. Scaling against `camera.zoom` each frame keeps
 * the target the same size whether the map is zoomed right in or all the way out.
 */
const ARROW_SCREEN_PX = 52

/** The drawn glyph occupies this share of the quad; the rest is invisible hit area. */
const GLYPH_SHARE = 0.62

/**
 * Attack arrows: the only way to take a tile somebody already owns.
 *
 * This layer is what replaced the browse/conquer mode system. A click on an occupied tile is
 * ambiguous — it has to reach the owner's site, because that click is the product they bought —
 * so taking the tile needs its own target rather than its own mode. Modes hid "what does a click
 * do?" in state you had to check before every click; two distinct objects need no state at all.
 *
 * Arrows appear ONLY on occupied ground, and only where the buyer could actually attack. Empty
 * tiles get none: clicking one can only mean "claim", so there is nothing to disambiguate.
 */
export function AttackArrowLayer() {
  const ownedHexes = useGameStore((s) => s.ownedHexes)
  const selectedHexIds = useGameStore((s) => s.selectedHexIds)
  const myEmpireId = useGameStore((s) => s.myEmpireId)
  const pendingBrand = useGameStore((s) => s.pendingBrand)
  const toggleHexSelection = useGameStore((s) => s.toggleHexSelection)
  const setHoveredHex = useGameStore((s) => s.setHoveredHex)

  // Delegated to a plain function over plain state so this gating is actually testable — it is
  // exactly where arrows went missing, and inside a component no test could see it.
  // See lib/hex/attackArrowSelector.ts.
  const arrows = useMemo(
    () =>
      selectAttackArrows({
        ownedHexes,
        selectedHexIds,
        myEmpireId,
        pendingDomain: pendingBrand?.domain ?? null,
      }),
    [ownedHexes, selectedHexIds, myEmpireId, pendingBrand],
  )

  const texture = useArrowTexture()
  const [hovered, setHovered] = useState<AttackArrow | null>(null)

  if (arrows.length === 0) return null

  return (
    <>
      {arrows.map((arrow) => (
        <ArrowMarker
          key={arrow.id}
          arrow={arrow}
          texture={texture}
          onAttack={() => toggleHexSelection(hexIdFor(arrow.to))}
          onHoverChange={(hovering) => {
            setHovered(hovering ? arrow : null)
            setHoveredHex(hovering ? hexIdFor(arrow.to) : null)
          }}
        />
      ))}

      <AttackHint arrow={hovered} price={hovered ? requiredPriceForHex(resolveHexAt(ownedHexes, hovered.to)) : 0} />
    </>
  )
}

/**
 * The small label that appears while an arrow is hovered.
 *
 * Two constraints shape this, both learned the hard way earlier in this map's life.
 *
 * It is COMPLETELY click-through — `pointerEvents: 'none'` on the wrapper and on the label itself.
 * It floats directly over tiles somebody is about to click, and a previous floating panel here
 * swallowed those clicks and sent people to the wrong place.
 *
 * And the `<Html>` host stays MOUNTED, moving between arrows rather than being conditionally
 * rendered. drei's Html spins up its own container and a separate ReactDOM root on mount; hanging
 * that off a hover meant building and tearing down a React root for every arrow the pointer
 * crossed, which reads as flicker.
 *
 * No `distanceFactor` and no `occlude`: under an orthographic camera the former scales by
 * `camera.zoom` (which once rendered a card at 320x) and the latter raycasts the whole scene every
 * frame and toggles `display`.
 */
function AttackHint({ arrow, price }: { arrow: AttackArrow | null; price: number }) {
  // Held so the label has somewhere to sit between hovers, while the host stays mounted.
  const lastPosition = useRef<[number, number, number]>([0, ARROW_ELEVATION, 0])
  if (arrow) lastPosition.current = [arrow.x, ARROW_ELEVATION, arrow.z]

  return (
    <Html
      position={lastPosition.current}
      center
      zIndexRange={[40, 0]}
      style={{ pointerEvents: 'none' }}
    >
      <div
        style={{ transform: 'translateY(-46px)', pointerEvents: 'none' }}
        className={`whitespace-nowrap rounded-full border border-hexwars-coral/50 bg-glass px-2.5 py-1 text-[11px] font-semibold text-white shadow-glow-coral backdrop-blur-hud transition-opacity duration-100 ${
          arrow ? 'opacity-100' : 'opacity-0'
        }`}
      >
        Take over this tile — make it yours
        <span className="ml-1.5 font-mono text-hexwars-coral">{formatCents(price)}</span>
      </div>
    </Html>
  )
}

function ArrowMarker({
  arrow,
  texture,
  onAttack,
  onHoverChange,
}: {
  arrow: AttackArrow
  texture: THREE.Texture
  onAttack: () => void
  onHoverChange: (hovering: boolean) => void
}) {
  const groupRef = useRef<THREE.Group>(null)
  const materialRef = useRef<THREE.MeshBasicMaterial>(null)
  const camera = useThree((state) => state.camera)
  const pressRef = useRef<{ x: number; y: number } | null>(null)

  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    const zoom = (camera as THREE.OrthographicCamera).zoom || 1
    // world size * zoom = screen pixels for an orthographic camera.
    group.scale.setScalar(ARROW_SCREEN_PX / zoom)
  })

  return (
    // Outer group carries the heading; the mesh inside lies flat. Splitting them avoids composing
    // two rotations into a single Euler, which is easy to get subtly wrong.
    <group ref={groupRef} position={[arrow.x, ARROW_ELEVATION, arrow.z]} rotation={[0, -arrow.angle, 0]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={5}
        onPointerOver={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation()
          if (materialRef.current) materialRef.current.opacity = 1
          onHoverChange(true)
        }}
        onPointerOut={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation()
          if (materialRef.current) materialRef.current.opacity = 0.88
          onHoverChange(false)
        }}
        onPointerDown={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation()
          pressRef.current = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY }
        }}
        onPointerUp={(event: ThreeEvent<PointerEvent>) => {
          const press = pressRef.current
          pressRef.current = null
          if (!press) return
          // Same tap-vs-drag threshold the tiles use, so panning across an arrow never fires it.
          if (
            Math.abs(event.nativeEvent.clientX - press.x) > 5 ||
            Math.abs(event.nativeEvent.clientY - press.y) > 5
          ) {
            return
          }
          event.stopPropagation()
          onAttack()
        }}
      >
        {/* The quad is the hit area and is deliberately larger than the glyph drawn on it. */}
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          ref={materialRef}
          map={texture}
          transparent
          opacity={0.88}
          toneMapped={false}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
    </group>
  )
}

/**
 * The arrow glyph, drawn once and shared by every marker.
 *
 * Points along +X in texture space, which the marker's own rotation then aims at the target.
 */
function useArrowTexture(): THREE.Texture {
  const texture = useMemo(() => {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')

    if (ctx) {
      const cx = size / 2
      const cy = size / 2
      const reach = (size / 2) * GLYPH_SHARE

      // Dark disc behind the glyph so a coral arrow stays visible over a coral or pink territory.
      ctx.beginPath()
      ctx.arc(cx, cy, reach * 0.95, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(9,12,18,0.72)'
      ctx.fill()
      ctx.lineWidth = size * 0.035
      ctx.strokeStyle = 'rgba(255,51,102,0.9)'
      ctx.stroke()

      // Chevron pointing +X (right).
      ctx.beginPath()
      ctx.moveTo(cx - reach * 0.42, cy - reach * 0.52)
      ctx.lineTo(cx + reach * 0.6, cy)
      ctx.lineTo(cx - reach * 0.42, cy + reach * 0.52)
      ctx.lineTo(cx - reach * 0.14, cy)
      ctx.closePath()
      ctx.fillStyle = '#FF3366'
      ctx.fill()
      ctx.lineWidth = size * 0.02
      ctx.strokeStyle = 'rgba(9,12,18,0.8)'
      ctx.stroke()
    }

    const canvasTexture = new THREE.CanvasTexture(canvas)
    canvasTexture.colorSpace = THREE.SRGBColorSpace
    canvasTexture.anisotropy = 4
    canvasTexture.needsUpdate = true
    return canvasTexture
  }, [])

  useEffect(() => () => texture.dispose(), [texture])

  return texture
}
