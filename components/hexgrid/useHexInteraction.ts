import { useCallback, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { axialToPixel, type AxialCoord } from '@/lib/hex/hexMath'

const HOVER_LIFT = 0.15
const LERP_SPEED = 12 // higher = snappier; tuned against useFrame's delta, not a frame-count constant
const SNAP_EPSILON = 0.002

type UseHexInteractionArgs = {
  hexCoords: AxialCoord[]
  hexIdForCoord: (coord: AxialCoord) => string
  size: number
  /** Y-axis rotation baked into every instance's base transform (e.g. flat-top alignment). */
  rotationY?: number
  onHoverChange: (hexId: string | null) => void
  onSelect: (hexId: string) => void
}

/**
 * Wires pointer events for a single InstancedMesh of hexes to the game's selection state.
 * R3F's built-in raycasting already resolves `event.instanceId` for instanced meshes — this
 * hook's job is just mapping that index back to a hex coordinate, and animating the hover lift
 * smoothly instead of snapping the instance matrix in place.
 */
export function useHexInteraction({
  hexCoords,
  hexIdForCoord,
  size,
  rotationY = 0,
  onHoverChange,
  onSelect,
}: UseHexInteractionArgs) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const hoveredIndexRef = useRef<number | null>(null)
  const dummy = useRef(new THREE.Object3D()).current

  // index -> current elevation, only for instances that are mid-transition (hovering in/out).
  // Avoids touching all N instances every frame — only the handful currently animating.
  const animatingRef = useRef(new Map<number, number>())

  const basePosition = useCallback(
    (index: number) => {
      const coord = hexCoords[index]
      if (!coord) return null
      return axialToPixel(coord, size)
    },
    [hexCoords, size],
  )

  const writeInstanceElevation = useCallback(
    (index: number, elevation: number) => {
      const mesh = meshRef.current
      const pos = basePosition(index)
      if (!mesh || !pos) return
      dummy.position.set(pos.x, elevation, pos.z)
      dummy.rotation.set(0, rotationY, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
      mesh.instanceMatrix.needsUpdate = true
    },
    // `rotationY` was missing here: the callback baked in whichever value it closed over on the
    // first render, so a caller passing a changing rotation would silently get a stale one.
    [basePosition, dummy, rotationY],
  )

  useFrame((_, delta) => {
    if (animatingRef.current.size === 0) return
    const t = Math.min(delta * LERP_SPEED, 1)

    for (const [index, current] of animatingRef.current) {
      const target = index === hoveredIndexRef.current ? HOVER_LIFT : 0
      const next = THREE.MathUtils.lerp(current, target, t)

      if (Math.abs(next - target) < SNAP_EPSILON) {
        writeInstanceElevation(index, target)
        animatingRef.current.delete(index)
      } else {
        writeInstanceElevation(index, next)
        animatingRef.current.set(index, next)
      }
    }
  })

  const beginTransition = useCallback((index: number) => {
    if (!animatingRef.current.has(index)) {
      const startElevation = index === hoveredIndexRef.current ? 0 : HOVER_LIFT
      animatingRef.current.set(index, startElevation)
    }
  }, [])

  const handlePointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation()
      const index = event.instanceId
      if (index === undefined || index === hoveredIndexRef.current) return

      const previous = hoveredIndexRef.current
      hoveredIndexRef.current = index
      if (previous !== null) beginTransition(previous)
      beginTransition(index)

      const coord = hexCoords[index]
      onHoverChange(coord ? hexIdForCoord(coord) : null)
    },
    [beginTransition, hexCoords, hexIdForCoord, onHoverChange],
  )

  // No relatedTarget inspection here any more: R3F synthesizes this from its own per-move
  // raycasting, so the underlying native event is a `pointermove`, which never carries a
  // relatedTarget. Keeping the card reachable is lib/state/hoverIntent.ts's job instead.
  const handlePointerOut = useCallback(
    () => {
      if (hoveredIndexRef.current !== null) {
        beginTransition(hoveredIndexRef.current)
        hoveredIndexRef.current = null
      }
      onHoverChange(null)
    },
    [beginTransition, onHoverChange],
  )

  // Selection is driven by an explicit pointerdown/pointerup pair with a drag threshold rather
  // than R3F's synthesized `click`. With MapControls attached to the same canvas, the synthesized
  // click was observed to drop the first interaction entirely (verified in a real browser: hover
  // worked, the first click selected nothing, a later one did). Owning the gesture here makes
  // selection deterministic and cleanly separates "tapped a hex" from "dragged the camera".
  const pressRef = useRef<{ x: number; y: number; index: number } | null>(null)
  const DRAG_THRESHOLD_PX = 5

  const handlePointerDown = useCallback((event: ThreeEvent<PointerEvent>) => {
    const index = event.instanceId
    if (index === undefined) {
      pressRef.current = null
      return
    }
    pressRef.current = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY, index }
  }, [])

  const handlePointerUp = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const press = pressRef.current
      pressRef.current = null
      if (!press) return

      const movedX = Math.abs(event.nativeEvent.clientX - press.x)
      const movedY = Math.abs(event.nativeEvent.clientY - press.y)
      if (movedX > DRAG_THRESHOLD_PX || movedY > DRAG_THRESHOLD_PX) return // camera pan, not a tap

      const index = event.instanceId ?? press.index
      const coord = hexCoords[index]
      if (!coord) return
      event.stopPropagation()
      onSelect(hexIdForCoord(coord))
    },
    [hexCoords, hexIdForCoord, onSelect],
  )

  return { meshRef, handlePointerMove, handlePointerOut, handlePointerDown, handlePointerUp }
}
