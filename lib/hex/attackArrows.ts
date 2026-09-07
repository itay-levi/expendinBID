import { HEX_DIRECTIONS, axialKey, axialToPixel, type AxialCoord } from './hexMath'

/** One available attack: a tile you hold, the rival tile it borders, and where to draw the arrow. */
export type AttackArrow = {
  /** The tile the attack comes from — yours, or already in your basket. */
  from: AxialCoord
  /** The rival tile being attacked. */
  to: AxialCoord
  /** Stable identity, so React keys don't churn as the map updates. */
  id: string
  /** Midpoint of the shared edge, in world XZ — where the arrow is drawn. */
  x: number
  z: number
  /** Direction of the attack in world XZ, radians. The arrow points along it, into `to`. */
  angle: number
}

export type AttackArrowInput = {
  /** Owner of a coordinate, or null for open ground. */
  getOwnerAt: (coord: AxialCoord) => string | null | undefined
  /** The attacker's empire id, when they have one. */
  acquiringEmpireId: string | null
  /** Coordinate keys the attacker already holds. */
  ownedKeys: ReadonlySet<string>
  /** Coordinate keys in the current basket — pending tiles can be attacked from too. */
  selectedKeys: ReadonlySet<string>
}

/**
 * Every attack a buyer can currently make, one arrow each.
 *
 * The arrow exists ONLY on ground somebody else owns, because that is the only place a click is
 * ambiguous. An empty tile can mean nothing but "claim it" — there is no site to visit — so putting
 * an arrow there would be interface for a decision nobody has to make. Occupied tiles are where the
 * conflict lives: a plain click has to reach the advertiser's site (that click is what they paid
 * for), so taking the tile needs a target of its own.
 *
 * That single rule replaces the whole browse/conquer mode system. Modes hid "what does a click do?"
 * in invisible state that had to be checked before every click; two distinct targets need no state
 * at all.
 *
 * Arrows are generated from the attacker's border outward, so the count is bounded by how much
 * territory they hold rather than by the size of the map — an empire with four tiles sees a handful
 * of arrows, not one per rival tile in the world.
 */
export function computeAttackArrows(
  candidates: AxialCoord[],
  { getOwnerAt, acquiringEmpireId, ownedKeys, selectedKeys }: AttackArrowInput,
): AttackArrow[] {
  const arrows: AttackArrow[] = []
  const claimed = new Set<string>()

  for (const target of candidates) {
    const targetKey = axialKey(target)
    const owner = getOwnerAt(target) ?? null

    // Open ground needs no arrow, and neither does ground you already hold or have selected.
    if (!owner) continue
    if (acquiringEmpireId !== null && owner === acquiringEmpireId) continue
    if (ownedKeys.has(targetKey) || selectedKeys.has(targetKey)) continue

    // One arrow per target, from the first bordering tile the attacker controls. Drawing one per
    // shared edge would stack up to six arrows on a tile surrounded by the attacker.
    if (claimed.has(targetKey)) continue

    const source = HEX_DIRECTIONS.map((direction) => ({
      q: target.q + direction.q,
      r: target.r + direction.r,
    })).find((neighbor) => {
      const neighborKey = axialKey(neighbor)
      return ownedKeys.has(neighborKey) || selectedKeys.has(neighborKey)
    })

    if (!source) continue // not reachable from this buyer's border

    const fromPixel = axialToPixel(source, 1)
    const toPixel = axialToPixel(target, 1)

    claimed.add(targetKey)
    arrows.push({
      from: source,
      to: target,
      id: `${axialKey(source)}->${targetKey}`,
      // The shared edge midpoint is exactly halfway between the two centres.
      x: (fromPixel.x + toPixel.x) / 2,
      z: (fromPixel.z + toPixel.z) / 2,
      angle: Math.atan2(toPixel.z - fromPixel.z, toPixel.x - fromPixel.x),
    })
  }

  return arrows
}

/**
 * Rival tiles worth testing for an arrow: the ring immediately outside the attacker's territory.
 *
 * Scanning every visible tile would work but wastes effort on ground nowhere near their border.
 * Only tiles touching what they hold can ever carry an arrow.
 */
export function attackCandidates(
  ownedKeys: ReadonlySet<string>,
  selectedKeys: ReadonlySet<string>,
  coordFromKey: (key: string) => AxialCoord | null,
): AxialCoord[] {
  const seen = new Set<string>()
  const candidates: AxialCoord[] = []

  for (const key of [...ownedKeys, ...selectedKeys]) {
    const coord = coordFromKey(key)
    if (!coord) continue

    for (const direction of HEX_DIRECTIONS) {
      const neighbor = { q: coord.q + direction.q, r: coord.r + direction.r }
      const neighborKey = axialKey(neighbor)
      if (seen.has(neighborKey) || ownedKeys.has(neighborKey) || selectedKeys.has(neighborKey)) continue
      seen.add(neighborKey)
      candidates.push(neighbor)
    }
  }

  return candidates
}
