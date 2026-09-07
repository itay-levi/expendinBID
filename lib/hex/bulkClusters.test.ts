import { describe, expect, it } from 'vitest'
import { hexesInRadius, isValidBulkCluster } from './bulkClusters'
import { BULK_CLUSTER_SIZES } from '@/lib/pricing/takeoverPricing'
import type { AxialCoord } from './hexMath'

describe('hexesInRadius', () => {
  it('produces exactly the 7-hex and 19-hex bulk-buy cluster sizes', () => {
    expect(hexesInRadius({ q: 0, r: 0 }, 1)).toHaveLength(BULK_CLUSTER_SIZES[0])
    expect(hexesInRadius({ q: 0, r: 0 }, 2)).toHaveLength(BULK_CLUSTER_SIZES[1])
  })

  it('centers the cluster on a non-origin hex', () => {
    const cluster = hexesInRadius({ q: 3, r: -2 }, 1)
    expect(cluster).toContainEqual({ q: 3, r: -2 })
    expect(cluster).toContainEqual({ q: 4, r: -2 })
    expect(cluster).toHaveLength(7)
  })
})

describe('isValidBulkCluster (discount anti-abuse)', () => {
  it('accepts a genuine 7-hex ring', () => {
    expect(isValidBulkCluster(hexesInRadius({ q: 2, r: -3 }, 1))).toBe(true)
  })

  it('accepts a genuine 19-hex double ring', () => {
    expect(isValidBulkCluster(hexesInRadius({ q: -4, r: 1 }, 2))).toBe(true)
  })

  it('accepts a cluster regardless of the order the coordinates arrive in', () => {
    const shuffled = [...hexesInRadius({ q: 0, r: 0 }, 1)].reverse()
    expect(isValidBulkCluster(shuffled)).toBe(true)
  })

  it('REJECTS 7 scattered hexes that are not a contiguous cluster', () => {
    // The exploit: 7 individually-eligible but unrelated tiles claiming the bundle discount.
    const scattered: AxialCoord[] = [
      { q: 0, r: 0 },
      { q: 5, r: 0 },
      { q: -5, r: 2 },
      { q: 3, r: -7 },
      { q: -2, r: 8 },
      { q: 9, r: -1 },
      { q: -8, r: -1 },
    ]
    expect(isValidBulkCluster(scattered)).toBe(false)
  })

  it('REJECTS a near-miss cluster with one hex swapped out for a distant one', () => {
    const ring = hexesInRadius({ q: 0, r: 0 }, 1)
    const tampered = [...ring.slice(0, 6), { q: 11, r: -3 }]
    expect(isValidBulkCluster(tampered)).toBe(false)
  })

  it('REJECTS duplicate ids padded to reach a discountable count', () => {
    const origin: AxialCoord = { q: 1, r: 1 }
    const padded = [origin, origin, origin, origin, origin, origin, origin]
    expect(isValidBulkCluster(padded)).toBe(false)
  })

  it('REJECTS counts that are not a discount tier', () => {
    expect(isValidBulkCluster(hexesInRadius({ q: 0, r: 0 }, 1).slice(0, 6))).toBe(false)
    expect(isValidBulkCluster([{ q: 0, r: 0 }])).toBe(false)
    expect(isValidBulkCluster([])).toBe(false)
  })
})
