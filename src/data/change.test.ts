import { describe, it, expect } from 'vitest'
import { percentChange } from './change'

describe('percentChange', () => {
  // Hennepin County, MN households: 508,030 ±1,677 (2015–2019) to
  // 539,493 ±1,860 (2020–2024), ACS 5-year table B11001.
  it('matches a worked Census example', () => {
    const r = percentChange(508030, 1677, 539493, 1860)!
    expect(r.change).toBeCloseTo(6.19, 2)
    expect(r.margin).toBeCloseTo(0.51, 2)
    expect(r.measurable).toBe(true)
  })

  it('calls a change inside its margin not measurable', () => {
    // Anoka County median household income in 2024 dollars
    const r = percentChange(101133, 1255, 101869, 2019)!
    expect(r.change).toBeCloseTo(0.73, 2)
    expect(r.margin).toBeGreaterThan(Math.abs(r.change))
    expect(r.measurable).toBe(false)
  })

  it('treats a zero margin as exact', () => {
    const r = percentChange(1000, 0, 990, 0)!
    expect(r.change).toBeCloseTo(-1, 6)
    expect(r.margin).toBe(0)
    expect(r.measurable).toBe(true)
  })

  it('gives nothing when a figure or margin is missing', () => {
    expect(percentChange(null, 5, 100, 5)).toBeNull()
    expect(percentChange(100, null, 100, 5)).toBeNull()
    expect(percentChange(100, 5, undefined, 5)).toBeNull()
    expect(percentChange(0, 5, 100, 5)).toBeNull()
  })
})
