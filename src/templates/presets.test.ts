import { describe, expect, it } from 'vitest'
import { DASHBOARD_TEMPLATES, TEMPLATE_IDS, getTemplate } from './presets'
import { CENSUS_VARIABLES } from '../data/variables'

describe('DASHBOARD_TEMPLATES', () => {
  it('ships at least the four expected presets', () => {
    expect(TEMPLATE_IDS).toContain('equity')
    expect(TEMPLATE_IDS).toContain('housing')
    expect(TEMPLATE_IDS).toContain('economic')
    expect(TEMPLATE_IDS).toContain('community')
  })

  it('every template variable is in the curated catalog', () => {
    for (const t of Object.values(DASHBOARD_TEMPLATES)) {
      for (const key of t.variables) {
        expect(
          CENSUS_VARIABLES[key],
          `${t.id}: variable "${key}" not in CENSUS_VARIABLES`,
        ).toBeDefined()
      }
    }
  })

  it('every template activeKpi is in its variables list', () => {
    for (const t of Object.values(DASHBOARD_TEMPLATES)) {
      expect(
        t.variables.includes(t.activeKpi),
        `${t.id}: activeKpi "${t.activeKpi}" missing from variables`,
      ).toBe(true)
    }
  })
})

describe('getTemplate', () => {
  it('returns a known template', () => {
    expect(getTemplate('equity').id).toBe('equity')
  })

  it('throws with a useful message for unknown ids', () => {
    expect(() => getTemplate('nonsense')).toThrow(/Unknown template/)
  })
})
