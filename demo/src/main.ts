/// <reference types="vite/client" />
/**
 * The live demo. Everything it shows is public data saved with the page
 * (see scripts/build-demo-data.py), so there is no API key here and nothing
 * for a visitor to set up.
 */
import {
  LocalVisionApp,
  BoundaryLoader,
  bindDataToBoundaries,
  DEFAULT_THEME,
  LIGHT_THEME,
} from '../../src/index'
import type { DataBinding, DataRow, DataTable, GeoJsonFeatureCollection, PlaceIndexEntry } from '../../src/index'
import { getStateMeta } from '../../src/geo/fips'
import { bboxCenter, findFeatureContaining } from '../../src/geo/spatial'

type Level = 'county' | 'place' | 'tract'
interface SavedData { periods: string[]; measures: string[]; rows: Record<string, (number | null)[]> }

const DATA = `${import.meta.env.BASE_URL}data`
const METRO_ID = 'msp7'
const METRO_COUNTIES = new Set(['003', '019', '037', '053', '123', '139', '163'])
const METRO: PlaceIndexEntry = {
  geoid: METRO_ID,
  name: 'Twin Cities metro',
  stateFips: '27',
  stateAbbr: 'MN',
  displayName: 'Twin Cities metro, MN',
  population: Number.MAX_SAFE_INTEGER, // always first among its matches
  region: true,
}

const MEASURES = [
  { key: 'population', code: 'B01003_001E', label: 'Population', format: 'number', category: 'community' },
  { key: 'households', code: 'B11001_001E', label: 'Households', format: 'number', category: 'community' },
  { key: 'median_household_income', code: 'B19013_001E', label: 'Median household income (2024 dollars)', format: 'currency', category: 'economy' },
  { key: 'median_gross_rent', code: 'B25064_001E', label: 'Median gross rent (2024 dollars)', format: 'currency', category: 'housing' },
] as const

// ── saved files ──────────────────────────────────────────────────────────────

const jsonCache = new Map<string, Promise<unknown>>()
function getJson<T>(path: string): Promise<T> {
  let p = jsonCache.get(path)
  if (!p) {
    p = fetch(`${DATA}/${path}`).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`)
      return r.json()
    })
    p.catch(() => jsonCache.delete(path))
    jsonCache.set(path, p)
  }
  return p as Promise<T>
}

async function loadPlaces(): Promise<PlaceIndexEntry[]> {
  const rows = await getJson<[string, string, number | null][]>('places.json')
  const list: PlaceIndexEntry[] = [METRO]
  for (const [geoid, name, population] of rows) {
    const stateFips = geoid.slice(0, 2)
    const stateAbbr = getStateMeta(stateFips)?.abbr ?? ''
    list.push({ geoid, name, stateFips, stateAbbr, displayName: `${name}, ${stateAbbr}`, population: population ?? 0 })
  }
  return list
}

// ── boundaries ───────────────────────────────────────────────────────────────

// Slightly simplified shapes: several times smaller to download, no visible difference on the map.
const loader = new BoundaryLoader({ persistentCache: true, simplifyTolerance: 0.0002 })

/** The opening view's boundaries are saved with the page; everything else comes live from the Census Bureau. */
async function boundariesFor(level: Level, stateFips: string, countyFips: string | undefined, isMetro: boolean): Promise<GeoJsonFeatureCollection> {
  const inMetro = stateFips === '27' && (isMetro || (countyFips !== undefined && METRO_COUNTIES.has(countyFips)))
  if (level === 'tract' && inMetro) {
    const all = await getJson<GeoJsonFeatureCollection>('metro/tracts.geojson')
    if (isMetro || !countyFips) return all
    return { type: 'FeatureCollection', features: all.features.filter((f) => f.properties?.['COUNTY'] === countyFips) }
  }
  if (level === 'county' && isMetro) return getJson<GeoJsonFeatureCollection>('metro/counties.geojson')
  if (level === 'county') return loader.counties(stateFips)
  if (level === 'place') {
    const places = await loader.places(stateFips)
    if (!isMetro) return places
    // keep the places whose middle falls inside one of the seven counties
    const counties = await getJson<GeoJsonFeatureCollection>('metro/counties.geojson')
    const inside = places.features.filter((f) => findFeatureContaining(bboxCenter(f.geometry), counties.features) !== null)
    return { type: 'FeatureCollection', features: inside }
  }
  return loader.tracts(stateFips, countyFips)
}

// ── figures ──────────────────────────────────────────────────────────────────

function tableFor(level: Level, saved: SavedData, boundaries: GeoJsonFeatureCollection): DataTable {
  const n = saved.measures.length
  const rows: DataRow[] = []
  for (const f of boundaries.features) {
    const geoid = String(f.properties?.['GEOID'] ?? '')
    const values = saved.rows[geoid]
    if (!values) continue
    saved.periods.forEach((period, p) => {
      const row: Record<string, number | null> = {}
      saved.measures.forEach((m, i) => { row[m] = values[p * n + i] ?? null })
      rows.push({ geoid, name: f.properties?.['NAME'] as string | undefined, values: row, time: period })
    })
  }
  return {
    variables: MEASURES.map((m) => ({ ...m })),
    rows,
    meta: { source: 'U.S. Census Bureau, American Community Survey 5-year estimates', geographyLevel: level },
    timeAxis: {
      times: saved.periods,
      label: saved.periods.length === 1 ? 'Tracts were redrawn in 2020, so only the latest period is shown.' : 'Survey period',
    },
  }
}

async function provide(level: string, parentGeoid: string, context: { stateFips?: string; countyFips?: string }): Promise<DataBinding | null> {
  if (level !== 'county' && level !== 'place' && level !== 'tract') return null
  const stateFips = context.stateFips ?? '27'
  const isMetro = parentGeoid === METRO_ID
  const [boundaries, saved] = await Promise.all([
    boundariesFor(level, stateFips, context.countyFips, isMetro),
    getJson<SavedData>(`${level}/${stateFips}.json`),
  ])
  return bindDataToBoundaries(boundaries, tableFor(level, saved, boundaries))
}

// ── the app, rebuilt when the theme changes ──────────────────────────────────

const root = document.documentElement
const toggle = document.getElementById('theme-toggle') as HTMLButtonElement
let app: LocalVisionApp | null = null

function mount(): void {
  app?.destroy()
  const light = root.dataset['theme'] === 'light'
  toggle.textContent = light ? 'Dark' : 'Light'
  app = new LocalVisionApp({
    container: '#app',
    theme: light ? LIGHT_THEME : DEFAULT_THEME,
    defaultView: 'inner',
    defaultInnerBoundary: 'tract',
    defaultOuterBoundary: 'place', // "Between cities" opens on cities; counties are the second choice
    levels: { inner: ['tract', 'place'], outer: ['place', 'county'] },
    placesIndex: loadPlaces,
    boundaryLoader: loader,
    initialCity: METRO_ID,
    viewLabels: { inner: 'Within city', outer: 'Between cities' },
    timeControl: 'switch',
    hideExport: true, // PNG export fails in Chrome; hidden here until it is fixed
    drillProvider: ({ level, parent, context }) => provide(level, parent.geoid, context),
    outer: { activeKpi: 'households' },
  })
}

toggle.addEventListener('click', () => {
  const next = root.dataset['theme'] === 'light' ? 'dark' : 'light'
  root.dataset['theme'] = next
  try { localStorage.setItem('lv-demo-theme', next) } catch { /* private window: the choice lasts for this visit only */ }
  mount() // the address bar keeps the city, level and period, so the view comes back as it was
})

const sources = document.getElementById('sources') as HTMLDialogElement
document.getElementById('sources-open')?.addEventListener('click', () => sources.showModal())
sources.addEventListener('click', (e) => { if (e.target === sources) sources.close() })

mount()
