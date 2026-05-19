/**
 * BoundaryLoader — fetches US Census geographic boundaries via two sources:
 *
 *  1. www2.census.gov static GeoJSON   — nation-scope files (states, all counties).
 *     Small, fast, CORS-enabled for national files.
 *
 *  2. Census TIGERweb REST API          — state-scoped layers (tracts, block groups,
 *     places, school districts, legislative districts, etc.).
 *     Fully CORS-enabled ArcGIS REST service; paginated automatically.
 *     https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/
 */

import type { GeoJsonFeatureCollection, GeoJsonFeature } from '../types'
import type { OuterLevel, InnerLevel } from './levels'
import { resolveStateFips, padCountyFips } from './fips'

// ─── Source config ────────────────────────────────────────────────────────────

const CENSUS_YEAR = '2022'
const STATIC_BASE = `https://www2.census.gov/geo/tiger/GENZ${CENSUS_YEAR}/json`

const TIGERWEB_BASE =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2022/MapServer'

const TIGERWEB_CENSUS2020_BASE =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer'

/**
 * Layer IDs within tigerWMS_ACS2022 MapServer.
 * These match the standard Census geography hierarchy ordering.
 */
const ACS_LAYER: Record<string, number> = {
  tract:  8,
  bg:     10,
  cousub: 12,
  cd:     18,  // 118th Congress
  sldu:   20,  // State Senate
  sldl:   22,  // State House
  unsd:   26,
  scsd:   28,
  elsd:   30,
  place:  46,
  county: 48,
  state:  50,
}

/**
 * ZCTAs live in the Census 2020 service (they're decennial, not ACS).
 */
const ZCTA_LAYER = 2

const PAGE_SIZE = 1000

// ─── Loader options ────────────────────────────────────────────────────────────

export interface BoundaryLoaderOptions {
  /**
   * Persist fetched GeoJSON in sessionStorage so page reloads don't re-fetch.
   * Defaults to false (in-memory cache only).
   */
  sessionCache?: boolean
  /**
   * Override layer IDs for TIGERweb MapServer. Useful if Census updates their
   * service structure. Keys match ACS_LAYER above.
   */
  layerOverrides?: Partial<Record<string, number>>
}

// ─── BoundaryLoader ────────────────────────────────────────────────────────────

export class BoundaryLoader {
  private memCache = new Map<string, GeoJsonFeatureCollection>()
  private useSessionCache: boolean
  private layers: Record<string, number>

  constructor(options: BoundaryLoaderOptions = {}) {
    this.useSessionCache = options.sessionCache ?? false
    this.layers = { ...ACS_LAYER, ...options.layerOverrides }
  }

  // ── Outer levels ─────────────────────────────────────────────────────────────

  /** All 50 states + DC + territories (static national file). */
  states(): Promise<GeoJsonFeatureCollection> {
    return this.fetchStatic(`cb_${CENSUS_YEAR}_us_state_500k.json`)
  }

  /**
   * Counties. Fetches the full national file then optionally filters to a state.
   * @param stateFips - state FIPS, abbreviation, or full name (optional)
   */
  async counties(stateFips?: string): Promise<GeoJsonFeatureCollection> {
    const all = await this.fetchStatic(`cb_${CENSUS_YEAR}_us_county_500k.json`)
    if (!stateFips) return all
    const fips = resolveStateFips(stateFips)
    return filterFeatures(all, (f) => String(f.properties?.['STATEFP'] ?? '') === fips)
  }

  /**
   * Incorporated places and Census Designated Places (CDPs) for a state.
   */
  places(stateFips: string): Promise<GeoJsonFeatureCollection> {
    return this.tigerwebQuery('place', stateFips)
  }

  /**
   * County subdivisions (townships, boroughs, MCDs) for a state.
   */
  countySubdivisions(stateFips: string): Promise<GeoJsonFeatureCollection> {
    return this.tigerwebQuery('cousub', stateFips)
  }

  // ── Inner levels ─────────────────────────────────────────────────────────────

  /**
   * Census tracts for a state, optionally filtered to a single county.
   */
  async tracts(stateFips: string, countyFips?: string): Promise<GeoJsonFeatureCollection> {
    const all = await this.tigerwebQuery('tract', stateFips)
    if (!countyFips) return all
    const cFips = padCountyFips(countyFips)
    return filterFeatures(all, (f) => String(f.properties?.['COUNTY'] ?? '') === cFips)
  }

  /**
   * Block groups for a state, optionally filtered to a single county.
   */
  async blockGroups(stateFips: string, countyFips?: string): Promise<GeoJsonFeatureCollection> {
    const all = await this.tigerwebQuery('bg', stateFips)
    if (!countyFips) return all
    const cFips = padCountyFips(countyFips)
    return filterFeatures(all, (f) => String(f.properties?.['COUNTY'] ?? '') === cFips)
  }

  /**
   * ZIP Code Tabulation Areas — fetched from the Census 2020 service.
   * This is a large dataset (~15 MB). Use filterByBbox() to trim to your area.
   */
  zctas(): Promise<GeoJsonFeatureCollection> {
    return this.tigerwebQueryRaw(
      TIGERWEB_CENSUS2020_BASE,
      ZCTA_LAYER,
      '1=1',
      ['GEOID20', 'ZCTA5CE20'],
    )
  }

  /** Congressional districts (118th Congress) for a state. */
  congressionalDistricts(stateFips: string): Promise<GeoJsonFeatureCollection> {
    return this.tigerwebQuery('cd', stateFips)
  }

  /** Unified school districts for a state. */
  unifiedSchoolDistricts(stateFips: string): Promise<GeoJsonFeatureCollection> {
    return this.tigerwebQuery('unsd', stateFips)
  }

  /** Elementary school districts for a state. */
  elementarySchoolDistricts(stateFips: string): Promise<GeoJsonFeatureCollection> {
    return this.tigerwebQuery('elsd', stateFips)
  }

  /** Secondary school districts for a state. */
  secondarySchoolDistricts(stateFips: string): Promise<GeoJsonFeatureCollection> {
    return this.tigerwebQuery('scsd', stateFips)
  }

  /** State legislative districts — lower chamber (state house). */
  stateLowerDistricts(stateFips: string): Promise<GeoJsonFeatureCollection> {
    return this.tigerwebQuery('sldl', stateFips)
  }

  /** State legislative districts — upper chamber (state senate). */
  stateUpperDistricts(stateFips: string): Promise<GeoJsonFeatureCollection> {
    return this.tigerwebQuery('sldu', stateFips)
  }

  // ── Generic level dispatch ────────────────────────────────────────────────────

  outerLevel(level: OuterLevel, stateFips?: string): Promise<GeoJsonFeatureCollection> {
    switch (level) {
      case 'state':   return this.states()
      case 'county':  return this.counties(stateFips)
      case 'place':   return this.places(stateFips ?? throwMissing('stateFips', level))
      case 'cousub':  return this.countySubdivisions(stateFips ?? throwMissing('stateFips', level))
    }
  }

  innerLevel(
    level: InnerLevel,
    stateFips: string,
    countyFips?: string,
  ): Promise<GeoJsonFeatureCollection> {
    switch (level) {
      case 'tract':  return this.tracts(stateFips, countyFips)
      case 'bg':     return this.blockGroups(stateFips, countyFips)
      case 'zcta':   return this.zctas()
      case 'cousub': return this.countySubdivisions(stateFips)
      case 'place':  return this.places(stateFips)
      case 'cd':     return this.congressionalDistricts(stateFips)
      case 'unsd':   return this.unifiedSchoolDistricts(stateFips)
      case 'elsd':   return this.elementarySchoolDistricts(stateFips)
      case 'scsd':   return this.secondarySchoolDistricts(stateFips)
      case 'sldl':   return this.stateLowerDistricts(stateFips)
      case 'sldu':   return this.stateUpperDistricts(stateFips)
    }
  }

  // ── Spatial utilities ─────────────────────────────────────────────────────────

  filterByBbox(
    fc: GeoJsonFeatureCollection,
    bbox: [number, number, number, number],
  ): GeoJsonFeatureCollection {
    const [west, south, east, north] = bbox
    return filterFeatures(fc, (f) => {
      const coords = collectCoords(f.geometry)
      return coords.some(([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north)
    })
  }

  filterByState(fc: GeoJsonFeatureCollection, stateFips: string): GeoJsonFeatureCollection {
    const fips = resolveStateFips(stateFips)
    return filterFeatures(
      fc,
      (f) =>
        String(f.properties?.['STATEFP'] ?? '') === fips ||
        String(f.properties?.['STATE'] ?? '') === fips,
    )
  }

  clearCache(): void {
    this.memCache.clear()
    if (this.useSessionCache && typeof sessionStorage !== 'undefined') {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith('lv_geo_'))
        .forEach((k) => sessionStorage.removeItem(k))
    }
  }

  // ── Internal: static national files ──────────────────────────────────────────

  private fetchStatic(filename: string): Promise<GeoJsonFeatureCollection> {
    return this.cached(`static:${filename}`, () =>
      fetch(`${STATIC_BASE}/${filename}`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${filename}`)
          return r.json() as Promise<GeoJsonFeatureCollection>
        }),
    )
  }

  // ── Internal: TIGERweb paginated queries ──────────────────────────────────────

  private tigerwebQuery(
    layerKey: string,
    stateFips: string,
    extraFields: string[] = [],
  ): Promise<GeoJsonFeatureCollection> {
    const fips = resolveStateFips(stateFips)
    const layerId = this.layers[layerKey]
    if (layerId === undefined) throw new Error(`[LocalVision] Unknown TIGERweb layer key: "${layerKey}"`)

    const where = `STATE='${fips}'`
    const fields = ['NAME', 'GEOID', 'STATE', 'COUNTY', ...extraFields]
    return this.tigerwebQueryRaw(TIGERWEB_BASE, layerId, where, fields, `tw:${layerKey}:${fips}`)
  }

  private async tigerwebQueryRaw(
    serviceBase: string,
    layerId: number,
    where: string,
    outFields: string[],
    cacheKey?: string,
  ): Promise<GeoJsonFeatureCollection> {
    const key = cacheKey ?? `tw:${serviceBase}:${layerId}:${where}`

    return this.cached(key, async () => {
      const features: GeoJsonFeature[] = []
      let offset = 0
      let keepGoing = true

      while (keepGoing) {
        const params = new URLSearchParams({
          where,
          outFields: outFields.join(','),
          returnGeometry: 'true',
          outSR: '4326',
          f: 'geojson',
          resultOffset: String(offset),
          resultRecordCount: String(PAGE_SIZE),
        })

        const url = `${serviceBase}/${layerId}/query?${params.toString()}`
        const res = await fetch(url)

        if (!res.ok) {
          throw new Error(
            `[LocalVision] TIGERweb request failed: HTTP ${res.status}\n  Layer: ${layerId}, where: ${where}`,
          )
        }

        const page = await res.json() as GeoJsonFeatureCollection & { error?: { message: string } }

        if ('error' in page && page.error) {
          throw new Error(`[LocalVision] TIGERweb error: ${page.error.message}\n  Layer: ${layerId}`)
        }

        const pageFeatures = page.features ?? []
        features.push(...pageFeatures)

        keepGoing = pageFeatures.length === PAGE_SIZE
        offset += PAGE_SIZE
      }

      return { type: 'FeatureCollection', features }
    })
  }

  // ── Internal: cache helpers ───────────────────────────────────────────────────

  private async cached(
    key: string,
    fn: () => Promise<GeoJsonFeatureCollection>,
  ): Promise<GeoJsonFeatureCollection> {
    const mem = this.memCache.get(key)
    if (mem) return mem

    if (this.useSessionCache && typeof sessionStorage !== 'undefined') {
      const stored = sessionStorage.getItem(`lv_geo_${key}`)
      if (stored) {
        const parsed = JSON.parse(stored) as GeoJsonFeatureCollection
        this.memCache.set(key, parsed)
        return parsed
      }
    }

    const data = await fn()
    this.memCache.set(key, data)

    if (this.useSessionCache && typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem(`lv_geo_${key}`, JSON.stringify(data))
      } catch {
        // quota exceeded — skip silently
      }
    }

    return data
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function filterFeatures(
  fc: GeoJsonFeatureCollection,
  predicate: (f: GeoJsonFeature) => boolean,
): GeoJsonFeatureCollection {
  return { type: 'FeatureCollection', features: fc.features.filter(predicate) }
}

function collectCoords(geometry: GeoJsonFeature['geometry']): number[][] {
  switch (geometry.type) {
    case 'Polygon':      return geometry.coordinates.flat()
    case 'MultiPolygon': return geometry.coordinates.flat(2)
    case 'Point':        return [geometry.coordinates]
    case 'LineString':   return geometry.coordinates
    default:             return []
  }
}

function throwMissing(param: string, level: string): never {
  throw new Error(`[LocalVision] "${param}" is required for level "${level}"`)
}
