import { describe, expect, it } from 'vitest'
import { computeDistributionStats, computeManyDistributions } from './aggregate'

describe('computeDistributionStats', () => {
  it('returns a zeroed result for an empty series', () => {
    const s = computeDistributionStats([])
    expect(s).toEqual({ count: 0, min: 0, max: 0, median: 0, mean: 0, bins: [] })
  })

  it('computes min / max / mean / median for a simple series', () => {
    const s = computeDistributionStats([1, 2, 3, 4, 5])
    expect(s.count).toBe(5)
    expect(s.min).toBe(1)
    expect(s.max).toBe(5)
    expect(s.mean).toBe(3)
    expect(s.median).toBe(3)
  })

  it('interpolates the median for an even-length series', () => {
    const s = computeDistributionStats([1, 2, 3, 4])
    expect(s.median).toBe(2.5)
  })

  it('filters out non-finite values', () => {
    const s = computeDistributionStats([1, NaN, 3, Infinity, 5])
    expect(s.count).toBe(3)
    expect(s.min).toBe(1)
    expect(s.max).toBe(5)
  })

  it('produces the requested number of bins', () => {
    const s = computeDistributionStats([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 10)
    expect(s.bins).toHaveLength(10)
    // Every value should be accounted for across bins
    const total = s.bins.reduce((n, b) => n + b.count, 0)
    expect(total).toBe(11)
  })

  it('puts the max value in the last bin (boundary clamp)', () => {
    const s = computeDistributionStats([0, 50, 100], 2)
    expect(s.bins).toHaveLength(2)
    // 100 must land in bin index 1, not overflow
    expect(s.bins[1].count).toBeGreaterThanOrEqual(1)
    const total = s.bins.reduce((n, b) => n + b.count, 0)
    expect(total).toBe(3)
  })

  it('handles a degenerate single-value range', () => {
    const s = computeDistributionStats([7, 7, 7], 12)
    expect(s.min).toBe(7)
    expect(s.max).toBe(7)
    expect(s.bins).toHaveLength(1)
    expect(s.bins[0].count).toBe(3)
  })
})

describe('computeManyDistributions', () => {
  it('computes stats per series', () => {
    const out = computeManyDistributions({
      income: [10, 20, 30],
      rent: [1, 2, 3, 4, 5],
    })
    expect(out.income.median).toBe(20)
    expect(out.rent.median).toBe(3)
    expect(out.rent.count).toBe(5)
  })

  it('returns an empty object for no series', () => {
    expect(computeManyDistributions({})).toEqual({})
  })
})
