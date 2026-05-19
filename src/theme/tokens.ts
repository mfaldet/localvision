import type { ThemeOverrides } from '../types'

export interface ResolvedTheme {
  fontFamily: string
  colorPrimary: string
  colorAccent: string
  colorBackground: string
  colorSurface: string
  colorSurfaceElevated: string
  colorBorder: string
  colorText: string
  colorTextMuted: string
  colorTextInverse: string
  borderRadius: string
  mapStyle: string
  // Derived chart palette
  chartPalette: string[]
}

export const DEFAULT_THEME: ResolvedTheme = {
  fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  colorPrimary: '#3B82F6',    // blue-500
  colorAccent: '#10B981',     // emerald-500
  colorBackground: '#0F1117', // near-black
  colorSurface: '#1A1D27',    // dark surface
  colorSurfaceElevated: '#22263A',
  colorBorder: '#2D3148',
  colorText: '#F0F2FF',
  colorTextMuted: '#8B92B4',
  colorTextInverse: '#0F1117',
  borderRadius: '8px',
  mapStyle: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  chartPalette: [
    '#3B82F6', // blue
    '#10B981', // emerald
    '#F59E0B', // amber
    '#8B5CF6', // violet
    '#EC4899', // pink
    '#06B6D4', // cyan
    '#F97316', // orange
    '#6EE7B7', // light emerald
  ],
}

export function resolveTheme(overrides?: ThemeOverrides): ResolvedTheme {
  return {
    ...DEFAULT_THEME,
    ...(overrides?.fontFamily ? { fontFamily: overrides.fontFamily } : {}),
    ...(overrides?.colorPrimary ? { colorPrimary: overrides.colorPrimary } : {}),
    ...(overrides?.colorAccent ? { colorAccent: overrides.colorAccent } : {}),
    ...(overrides?.colorBackground ? { colorBackground: overrides.colorBackground } : {}),
    ...(overrides?.colorSurface ? { colorSurface: overrides.colorSurface } : {}),
    ...(overrides?.colorText ? { colorText: overrides.colorText } : {}),
    ...(overrides?.colorTextMuted ? { colorTextMuted: overrides.colorTextMuted } : {}),
    ...(overrides?.borderRadius ? { borderRadius: overrides.borderRadius } : {}),
    ...(overrides?.mapStyle ? { mapStyle: overrides.mapStyle as string } : {}),
  }
}

export function applyThemeToDom(el: HTMLElement, theme: ResolvedTheme): void {
  el.style.setProperty('--lv-font', theme.fontFamily)
  el.style.setProperty('--lv-color-primary', theme.colorPrimary)
  el.style.setProperty('--lv-color-accent', theme.colorAccent)
  el.style.setProperty('--lv-color-bg', theme.colorBackground)
  el.style.setProperty('--lv-color-surface', theme.colorSurface)
  el.style.setProperty('--lv-color-surface-elevated', theme.colorSurfaceElevated)
  el.style.setProperty('--lv-color-border', theme.colorBorder)
  el.style.setProperty('--lv-color-text', theme.colorText)
  el.style.setProperty('--lv-color-text-muted', theme.colorTextMuted)
  el.style.setProperty('--lv-radius', theme.borderRadius)
}
