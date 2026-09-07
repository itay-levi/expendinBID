'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { axialToPixel, type AxialCoord } from '@/lib/hex/hexMath'
import { hexIdFor } from '@/lib/hex/hexIdentity'
import { HEX_SIZE } from '@/lib/hex/mapConfig'
import { MAX_VISIBLE_HEXES, hexesInWorldRect, orthographicGroundRect } from '@/lib/hex/viewport'
import { useGameStore } from '@/lib/state/gameStore'
import { useHexInteraction } from './useHexInteraction'
import { ISO_TILT } from './HexGridCanvas'

const PRISM_HEIGHT = 0.3
// CylinderGeometry with 6 radial segments IS a hex prism — no custom extrusion needed.
// Rotate 30deg so a flat side (not a point) faces the camera on the flat-top layout.
const FLAT_TOP_ROTATION = Math.PI / 6

/** World units of grid generated beyond the visible rect, so tiles never pop in at the edges. */
const VIEWPORT_PADDING = 3

/**
 * How far the camera must move, in world units, before the visible set is recomputed.
 *
 * Regenerating on every frame would rebuild the coordinate list 60 times a second while panning,
 * for a result that barely changes. The padding above covers the drift in between.
 */
const RECOMPUTE_THRESHOLD = 1.5

type EmptyHexFieldProps = {
  onHoverChange: (hexId: string | null) => void
  onSelect: (hexId: string) => void
}

/**
 * Every unclaimed hex the camera can currently see, as one instanced draw call.
 *
 * Generated from the viewport rather than from a fixed map radius, which is what makes the grid
 * genuinely unbounded: cost tracks screen area, not world size, so a player can pan outward
 * forever and always find fresh tiles, and nothing has to be pre-generated or migrated to make the
 * map bigger. Claimed hexes are subtracted here and drawn by BrandHexTile instead.
 */
export function EmptyHexField({ onHoverChange, onSelect }: EmptyHexFieldProps) {
  const ownedHexes = useGameStore((s) => s.ownedHexes)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)

  const [visibleCoords, setVisibleCoords] = useState<AxialCoord[]>([])
  const lastRectCenter = useRef<{ x: number; z: number; zoom: number } | null>(null)

  const viewDirection = useRef(new THREE.Vector3()).current

  useFrame(() => {
    const zoom = (camera as THREE.OrthographicCamera).zoom ?? 1

    // Where the camera's center ray actually meets the ground, rather than assuming a fixed offset
    // from its position. MapControls can drift its target off y=0 while panning, and any assumed
    // offset then slides out of true — which shows up as tiles missing along one screen edge.
    camera.getWorldDirection(viewDirection)
    if (Math.abs(viewDirection.y) < 1e-6) return // camera parallel to the ground: nothing to cover
    const distanceToGround = -camera.position.y / viewDirection.y
    const centerX = camera.position.x + viewDirection.x * distanceToGround
    const centerZ = camera.position.z + viewDirection.z * distanceToGround

    const previous = lastRectCenter.current
    const moved =
      previous === null ||
      Math.abs(previous.x - centerX) > RECOMPUTE_THRESHOLD ||
      Math.abs(previous.z - centerZ) > RECOMPUTE_THRESHOLD ||
      Math.abs(previous.zoom - zoom) > 0.5
    if (!moved) return

    lastRectCenter.current = { x: centerX, z: centerZ, zoom }
    const rect = orthographicGroundRect(
      { x: centerX, z: centerZ },
      size.width,
      size.height,
      zoom,
      ISO_TILT,
      VIEWPORT_PADDING,
    )
    setVisibleCoords(hexesInWorldRect(rect, HEX_SIZE, MAX_VISIBLE_HEXES))
  })

  const coords = useMemo(
    () => visibleCoords.filter((coord) => !ownedHexes.has(hexIdFor(coord))),
    [visibleCoords, ownedHexes],
  )

  const { meshRef, handlePointerMove, handlePointerOut, handlePointerDown, handlePointerUp } = useHexInteraction({
    hexCoords: coords,
    hexIdForCoord: hexIdFor,
    size: HEX_SIZE,
    rotationY: FLAT_TOP_ROTATION,
    onHoverChange,
    onSelect,
  })

  const geometry = useMemo(
    () => new THREE.CylinderGeometry(HEX_SIZE * 0.96, HEX_SIZE * 0.96, PRISM_HEIGHT, 6),
    [],
  )

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1E2638',
        metalness: 0.4,
        roughness: 0.65,
        emissive: '#2A364F',
        emissiveIntensity: 0.45,
      }),
    [],
  )

  // Three.js keeps these on the GPU until told otherwise; without this they leak on every remount
  // (React 18 StrictMode remounts every component once in dev, so this leaks immediately).
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  // Instance matrices are rewritten whenever the visible set changes; per-frame hover elevation is
  // handled inside useHexInteraction via imperative setMatrixAt on top of these base positions.
  const dummy = useRef(new THREE.Object3D()).current
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return

    coords.forEach((coord, index) => {
      const { x, z } = axialToPixel(coord, HEX_SIZE)
      dummy.position.set(x, 0, z)
      dummy.rotation.set(0, FLAT_TOP_ROTATION, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
    })

    // Draw only what's currently visible. The buffer stays at MAX_VISIBLE_HEXES so this count
    // changing never alters the element's `args`, which would make R3F tear down and rebuild the
    // whole InstancedMesh — on every pan, now that the visible set is dynamic.
    mesh.count = coords.length

    mesh.instanceMatrix.needsUpdate = true
    // Cached from the previous matrices otherwise, and three.js uses it for BOTH frustum culling
    // and the early-out in InstancedMesh.raycast — a stale sphere silently makes hexes unhoverable.
    mesh.computeBoundingSphere()
  }, [coords, dummy, meshRef])

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_VISIBLE_HEXES]}
      onPointerMove={handlePointerMove}
      onPointerOut={handlePointerOut}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    />
  )
}
