/** Seeded random numbers (mulberry32), so a run can be replayed with --seed. */
export type Rng = {
  next(): number
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number
  chance(probability: number): boolean
  pick<T>(items: readonly T[]): T
  shuffle<T>(items: readonly T[]): T[]
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1))

  return {
    next,
    int,
    chance: (probability) => next() < probability,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('rng.pick called with an empty list')
      return items[Math.floor(next() * items.length)] as T
    },
    shuffle<T>(items: readonly T[]): T[] {
      const copy = [...items]
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(next() * (index + 1))
        const held = copy[index] as T
        copy[index] = copy[swap] as T
        copy[swap] = held
      }
      return copy
    },
  }
}
