/**
 * Unit tests for FIPS resolution. The library accepts state input as
 * FIPS code, abbreviation, or full name — make sure each works and
 * invalid input fails loudly.
 */

import { describe, expect, it } from 'vitest'
import { resolveStateFips, getStateMeta, padCountyFips, STATES } from './fips'

describe('resolveStateFips', () => {
  it('accepts a 2-digit FIPS code', () => {
    expect(resolveStateFips('27')).toBe('27')
  })

  it('zero-pads a 1-digit code', () => {
    expect(resolveStateFips('1')).toBe('01')
  })

  it('accepts a 2-letter abbreviation, case-insensitive', () => {
    expect(resolveStateFips('MN')).toBe('27')
    expect(resolveStateFips('mn')).toBe('27')
  })

  it('accepts a full state name, case-insensitive', () => {
    expect(resolveStateFips('Minnesota')).toBe('27')
    expect(resolveStateFips('MINNESOTA')).toBe('27')
  })

  it('throws on garbage input', () => {
    expect(() => resolveStateFips('not-a-state')).toThrow(/Cannot resolve/)
  })

  it('throws on empty input', () => {
    expect(() => resolveStateFips('')).toThrow(/Cannot resolve/)
  })
})

describe('getStateMeta', () => {
  it('returns the meta entry for a valid state', () => {
    const meta = getStateMeta('27')
    expect(meta?.name).toBe('Minnesota')
    expect(meta?.abbr).toBe('MN')
    expect(meta?.fips).toBe('27')
  })

  it('accepts abbreviations + names too', () => {
    expect(getStateMeta('CA')?.name).toBe('California')
    expect(getStateMeta('California')?.fips).toBe('06')
  })

  it('returns undefined for invalid input', () => {
    expect(getStateMeta('XX')).toBeUndefined()
  })
})

describe('padCountyFips', () => {
  it('zero-pads to 3 digits', () => {
    expect(padCountyFips('5')).toBe('005')
    expect(padCountyFips(5)).toBe('005')
    expect(padCountyFips('053')).toBe('053')
  })
})

describe('STATES registry', () => {
  it('includes 50 states + DC + territories', () => {
    // 50 + DC = 51; territories add a handful more.
    expect(STATES.length).toBeGreaterThanOrEqual(50)
    expect(STATES.length).toBeLessThanOrEqual(60)
  })

  it('every entry has FIPS / name / abbr', () => {
    for (const s of STATES) {
      expect(s.fips).toMatch(/^\d{2}$/)
      expect(s.abbr).toMatch(/^[A-Z]{2}$/)
      expect(s.name).toBeTruthy()
    }
  })
})
