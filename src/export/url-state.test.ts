/**
 * Unit tests for shareable URL state. happy-dom provides window +
 * location so we can round-trip without hand-mocking.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import { readUrlState, writeUrlState, encodeUrlState } from './url-state'

beforeEach(() => {
  // Reset hash before each test so they don't bleed into each other
  window.location.hash = ''
})

describe('encodeUrlState', () => {
  it('omits empty fields', () => {
    expect(encodeUrlState({})).toBe('')
  })

  it('serializes core navigation state', () => {
    const encoded = encodeUrlState({
      city: '2754880',
      stateFips: '27',
      view: 'inner',
      level: 'tract',
    })
    expect(encoded).toContain('city=2754880')
    expect(encoded).toContain('state=27')
    expect(encoded).toContain('view=inner')
    expect(encoded).toContain('level=tract')
  })

  it('encodes compare flag as "1"', () => {
    expect(encodeUrlState({ compare: true })).toBe('compare=1')
  })

  it('omits compare when false', () => {
    expect(encodeUrlState({ compare: false })).toBe('')
  })
})

describe('readUrlState', () => {
  it('returns empty when hash is missing', () => {
    expect(readUrlState()).toEqual({})
  })

  it('parses a populated hash', () => {
    window.location.hash = '#city=2754880&view=outer&level=county&kpi=median_income'
    const state = readUrlState()
    expect(state.city).toBe('2754880')
    expect(state.view).toBe('outer')
    expect(state.level).toBe('county')
    expect(state.kpi).toBe('median_income')
  })

  it('rejects invalid view values', () => {
    window.location.hash = '#view=nonsense'
    expect(readUrlState().view).toBeUndefined()
  })

  it('parses compare=1 as true', () => {
    window.location.hash = '#compare=1'
    expect(readUrlState().compare).toBe(true)
  })

  it('parses compare=true also as true', () => {
    window.location.hash = '#compare=true'
    expect(readUrlState().compare).toBe(true)
  })
})

describe('writeUrlState round-trip', () => {
  it('writes + reads matches', () => {
    const input = {
      city: '2754880',
      stateFips: '27',
      view: 'inner' as const,
      level: 'tract',
      kpi: 'median_household_income',
      time: '2022',
      compare: true,
      compareKpi: 'median_gross_rent',
    }
    writeUrlState(input)
    const round = readUrlState()
    expect(round).toEqual(input)
  })
})
