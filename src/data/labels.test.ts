/**
 * Unit tests for the community-name cleaner. Census NAMEs vary in
 * separator (comma vs semicolon) and structure per geographic level —
 * exercise each branch.
 */

import { describe, expect, it } from 'vitest'
import { cleanCommunityName } from './labels'

describe('cleanCommunityName', () => {
  describe('tracts', () => {
    it('strips ACS suffix and renames to "Tract X.YY"', () => {
      expect(
        cleanCommunityName('Census Tract 605.04, Dakota County, Minnesota', 'tract'),
      ).toBe('Tract 605.04')
    })

    it('accepts whole-number tract IDs', () => {
      expect(
        cleanCommunityName('Census Tract 1001, Hennepin County, Minnesota', 'tract'),
      ).toBe('Tract 1001')
    })

    it('falls back to the first comma-separated part when the regex misses', () => {
      expect(cleanCommunityName('Weird Format, Whatever, Minnesota', 'tract')).toBe(
        'Weird Format',
      )
    })
  })

  describe('block groups', () => {
    it('handles comma-separated names', () => {
      expect(
        cleanCommunityName(
          'Block Group 1, Census Tract 605.04, Dakota County, Minnesota',
          'bg',
        ),
      ).toBe('BG 1 · Tract 605.04')
    })

    it('handles semicolon-separated names (ACS uses both)', () => {
      expect(
        cleanCommunityName(
          'Block Group 2; Census Tract 1001; Hennepin County; Minnesota',
          'bg',
        ),
      ).toBe('BG 2 · Tract 1001')
    })
  })

  describe('counties', () => {
    it('drops the state', () => {
      expect(cleanCommunityName('Dakota County, Minnesota', 'county')).toBe('Dakota County')
    })

    it('handles compound county names', () => {
      expect(
        cleanCommunityName('Saint Louis County, Minnesota', 'county'),
      ).toBe('Saint Louis County')
    })
  })

  describe('places & cousubs', () => {
    it('strips LSAD and state', () => {
      expect(cleanCommunityName('Rosemount city, Minnesota', 'place')).toBe('Rosemount')
    })

    it('handles township cousubs', () => {
      expect(
        cleanCommunityName('Eureka township, Dakota County, Minnesota', 'cousub'),
      ).toBe('Eureka')
    })
  })

  describe('ZCTAs', () => {
    it('extracts the 5-digit ZIP', () => {
      expect(cleanCommunityName('ZCTA5 55068', 'zcta')).toBe('55068')
    })
  })

  describe('edge cases', () => {
    it('passes through empty input', () => {
      expect(cleanCommunityName('', 'tract')).toBe('')
    })

    it('falls back to first part when level is undefined', () => {
      expect(cleanCommunityName('Some Name, Detail', undefined)).toBe('Some Name')
    })
  })
})
