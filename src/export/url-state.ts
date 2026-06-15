/**
 * Shareable URL state encoding for LocalVision.
 *
 * Strategy: encode a small snapshot of "what is the user looking at" as
 * a URL hash fragment (e.g. `#city=2754880&view=inner&level=tract`).
 * Hash fragments don't trigger reloads when changed and never travel to
 * the server.
 *
 * The state is intentionally minimal — just enough to reconstruct the
 * dashboard's framing. Style settings, drawn clips, layer toggles, etc.
 * stay in localStorage where they already live; they aren't part of a
 * "share this view" link.
 */

export interface UrlState {
  /** Selected city's GEOID (e.g. "2754880" for Rosemount, MN). */
  city?: string
  /** State FIPS for the selected city — needed to fetch the city's polygon. */
  stateFips?: string
  /** Active view: 'inner' or 'outer'. */
  view?: 'inner' | 'outer'
  /** Boundary level (tract / bg / county / place / cousub). */
  level?: string
  /** Active KPI on the active view. */
  kpi?: string
  /** Time index for the temporal slider, when present (e.g. "2022"). */
  time?: string
  /** Compare mode flag. */
  compare?: boolean
  /** Compare-mode right-side KPI when compare is enabled. */
  compareKpi?: string
}

/**
 * Parse the current URL's hash fragment into a UrlState. Tolerates
 * missing / malformed fields by returning undefined for those keys.
 */
export function readUrlState(): UrlState {
  if (typeof window === 'undefined') return {}
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash) return {}
  const params = new URLSearchParams(hash)
  const state: UrlState = {}
  const get = (k: string): string | undefined => params.get(k) ?? undefined
  state.city = get('city')
  state.stateFips = get('state')
  const view = get('view')
  if (view === 'inner' || view === 'outer') state.view = view
  state.level = get('level')
  state.kpi = get('kpi')
  state.time = get('time')
  const cmp = get('compare')
  if (cmp === '1' || cmp === 'true') state.compare = true
  state.compareKpi = get('compareKpi')
  return state
}

/**
 * Serialize a UrlState to a hash fragment string (without the leading
 * '#'). Empty / undefined values are omitted so the URL stays compact.
 */
export function encodeUrlState(state: UrlState): string {
  const params = new URLSearchParams()
  if (state.city) params.set('city', state.city)
  if (state.stateFips) params.set('state', state.stateFips)
  if (state.view) params.set('view', state.view)
  if (state.level) params.set('level', state.level)
  if (state.kpi) params.set('kpi', state.kpi)
  if (state.time != null) params.set('time', String(state.time))
  if (state.compare) params.set('compare', '1')
  if (state.compareKpi) params.set('compareKpi', state.compareKpi)
  return params.toString()
}

/**
 * Write a UrlState back to the browser's URL hash without triggering
 * a navigation or page reload.
 */
export function writeUrlState(state: UrlState): void {
  if (typeof window === 'undefined') return
  const encoded = encodeUrlState(state)
  const newHash = encoded ? `#${encoded}` : ''
  // Use replaceState so we don't pollute history on every selection change.
  history.replaceState(null, '', window.location.pathname + window.location.search + newHash)
}
