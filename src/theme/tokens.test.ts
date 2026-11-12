import { describe, it, expect } from 'vitest'
import { resolveTheme, DEFAULT_THEME, LIGHT_THEME } from './tokens'

describe('resolveTheme', () => {
  it('returns the dark defaults when nothing is passed', () => {
    expect(resolveTheme()).toEqual(DEFAULT_THEME)
  })

  it('carries every key of a full preset, not only the override subset', () => {
    const t = resolveTheme(LIGHT_THEME)
    expect(t.colorBorder).toBe(LIGHT_THEME.colorBorder)
    expect(t.colorSurfaceElevated).toBe(LIGHT_THEME.colorSurfaceElevated)
    expect(t.mapStyle).toBe(LIGHT_THEME.mapStyle)
  })

  it('ignores empty and undefined overrides', () => {
    const t = resolveTheme({ colorPrimary: '', colorText: undefined, colorAccent: '#123456' })
    expect(t.colorPrimary).toBe(DEFAULT_THEME.colorPrimary)
    expect(t.colorText).toBe(DEFAULT_THEME.colorText)
    expect(t.colorAccent).toBe('#123456')
  })

  it('needs no API key for its default maps', () => {
    for (const theme of [DEFAULT_THEME, LIGHT_THEME]) {
      expect(theme.mapStyle).toMatch(/^https:\/\/tiles\.openfreemap\.org\/styles\//)
    }
  })
})
