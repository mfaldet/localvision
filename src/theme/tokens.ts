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

/**
 * Light theme preset. Pass to LocalVisionApp as `theme: LIGHT_THEME` (or
 * spread into the options to override specific values).
 *
 * Designed for use with CARTO's "positron" basemap — light gray
 * background with high-contrast labels. Choropleth colors still pop on
 * the lighter surface; the chart palette is tuned for white backgrounds.
 */
export const LIGHT_THEME: ResolvedTheme = {
  fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  colorPrimary: '#2563EB',          // blue-600 (slightly darker for contrast on light bg)
  colorAccent: '#059669',           // emerald-600
  colorBackground: '#FFFFFF',
  colorSurface: '#F8FAFC',          // slate-50
  colorSurfaceElevated: '#F1F5F9',  // slate-100
  colorBorder: '#CBD5E1',           // slate-300
  colorText: '#0F172A',             // slate-900
  colorTextMuted: '#64748B',        // slate-500
  colorTextInverse: '#FFFFFF',
  borderRadius: '8px',
  mapStyle: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  chartPalette: [
    '#2563EB', // blue-600
    '#059669', // emerald-600
    '#D97706', // amber-600
    '#7C3AED', // violet-600
    '#DB2777', // pink-600
    '#0891B2', // cyan-600
    '#EA580C', // orange-600
    '#16A34A', // green-600
  ],
}

/**
 * Color-blind-safe Okabe-Ito palette for categorical chart marks.
 * Distinct under deuteranopia / protanopia / tritanopia. Source:
 * https://jfly.uni-koeln.de/color/
 */
export const OKABE_ITO_PALETTE = [
  '#E69F00', // orange
  '#56B4E9', // sky blue
  '#009E73', // bluish green
  '#F0E442', // yellow
  '#0072B2', // blue
  '#D55E00', // vermillion
  '#CC79A7', // reddish purple
  '#000000', // black (or use 'auto' bg)
]

/**
 * Theme presets registry. Useful for runtime theme switching.
 */
export const THEME_PRESETS: Record<string, ResolvedTheme> = {
  dark: DEFAULT_THEME,
  light: LIGHT_THEME,
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
  el.style.setProperty('--lv-color-text-inverse', theme.colorTextInverse)
  el.style.setProperty('--lv-radius', theme.borderRadius)
  // Tag the dark/light mode for any CSS rule that needs to branch on it
  // (e.g. attribution control inversion).
  const isLight = isLightBackground(theme.colorBackground)
  el.classList.toggle('lv-theme-light', isLight)
  el.classList.toggle('lv-theme-dark', !isLight)
}

/** Crude luminance check — returns true for "light" backgrounds (#FFFFFF, etc). */
function isLightBackground(hex: string): boolean {
  const m = hex.match(/^#?([a-fA-F0-9]{6})$/)
  if (!m) return false
  const r = parseInt(m[1].slice(0, 2), 16)
  const g = parseInt(m[1].slice(2, 4), 16)
  const b = parseInt(m[1].slice(4, 6), 16)
  // Relative luminance approximation
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 140 // light enough that we should use light-mode CSS rules
}
