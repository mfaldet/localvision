/**
 * BoundaryLoader — fetches and caches US Census Bureau cartographic boundary
 * GeoJSON files (1:500,000 scale).
 *
 * Data source: https://www2.census.gov/geo/tiger/GENZ{year}/json/
 * No API key required. Files are US-scope only.
 *
 * Cache: in-memory by default; opt-in sessionStorage for page-reload persistence.
 */

import type { GeoJsonFeatureCollection, GeoJsonFeature } from '../types'
import type { OuterLevel, InnerLevel } from './levels'
import { resolveStateFips, padCountyFips } from './fips'

const CENSUS_YEAR = '2023'
const BASE_URL = `https://www2.census.gov/geo/tiger/GENZ${CENSUS_YEAR}/json`

// ─── URL builders ─────────────────────────────────────────────────────────────

function url(filename: string): string {
  return `${BASE_URL}/${filename}`
}

function stateUrl(stateFips: string, layer: string, resolution = '500k'): string {
  return url(`cb_${CENSUS_YEAR}_${stateFips}_${layer}_${resolution}.json`)
}

function nationUrl(layer: string, resolution = '500k'): string {
  return url(`cb_${CENSUS_YEAR}_us_${layer}_${resolution}.json`)
}

// ─── Loader options ────────────────────────────────────────────────────────────

export interface BoundaryLoaderOptions {
  /**
   * Persist fetched GeoJSON in sessionStorage so page reloads don't re-fetch.
   * Defaults to false (in-memory cache only).
   */
  sessionCache?: boolean
  /**
   * Custom fetch function — useful for proxying or testing.
   */
  fetcher?: (url: string) => Promise<GeoJsonFeatureCollection>
}

// ─── BoundaryLoader ────────────────────────────────────────────────────────────

export class BoundaryLoader {
  private memCache = new Map<string, GeoJsonFeatureCollection>()
  private useSessionCache: boolean
  private fetcher: (url: string) => Promise<GeoJsonFeatureCollection>

  constructor(options: BoundaryLoaderOptions = {}) {
    this.useSessionCache = options.sessionCache ?? false
    this.fetcher = options.fetcher ?? defaultFetcher
  }

  // ── Outer levels ─────────────────────────────────────────────────────────────

  /** All 50 states + DC + territories. */
  states(): Promise<GeoJsonFeatureCollection> {
    return this.fetch(nationUrl('state'))
  }

  /** All ~3,200 US counties. Pass stateFips to get only that state's counties. */
  async counties(stateFips?: string): Promise<GeoJsonFeatureCollection> {
    const all = await this.fetch(nationUrl('county'))
    if (!stateFips) return all
    const fips = resolveStateFips(stateFips)
    return filterFeatures(all, (f) => String(f.properties?.['STATEFP'] ?? '').startsWith(fips))
  }

  /**
   * Incorporated places and Census Designated Places (CDPs) for a state.
   * @param stateFips - state FIPS, abbreviation, or full name
   */
  places(stateFips: string): Promise<GeoJsonFeatureCollection> {
    const fips = resolveStateFips(stateFips)
    return this.fetch(stateUrl(fips, 'place'))
  }

  /**
   * County subdivisions (townships, boroughs, MCDs) for a state.
   * @param stateFips - state FIPS, abbreviation, or full name
   */
  countySubdivisions(stateFips: string): Promise<GeoJsonFeatureCollection> {
    const fips = resolveStateFips(stateFips)
    return this.fetch(stateUrl(fips, 'cousub'))
  }

  // ── Inner levels ─────────────────────────────────────────────────────────────

  /**
   * Census tracts for a state, optionally filtered to a single county.
   * @param stateFips  - state FIPS, abbreviation, or full name
   * @param countyFips - optional 3-digit county FIPS to filter results
   */
  async tracts(stateFips: string, countyFips?: string): Promise<GeoJsonFeatureCollection> {
    const fips = resolveStateFips(stateFips)
    const all = await this.fetch(stateUrl(fips, 'tract'))
    if (!countyFips) return all
    const cFips = padCountyFips(countyFips)
    return filterFeatures(all, (f) => String(f.properties?.['COUNTYFP'] ?? '') === cFips)
  }

  /**
   * Block groups for a state, optionally filtered to a single county.
   * @param stateFips  - state FIPS, abbreviation, or full name
   * @param countyFips - optional 3-digit county FIPS to filter results
   */
  async blockGroups(stateFips: string, countyFips?: string): Promise<GeoJsonFeatureCollection> {
    const fips = resolveStateFips(stateFips)
    const all = await this.fetch(stateUrl(fips, 'bg'))
    if (!countyFips) return all
    const cFips = padCountyFips(countyFips)
    return filterFeatures(all, (f) => String(f.properties?.['COUNTYFP'] ?? '') === cFips)
  }

  /**
   * ZIP Code Tabulation Areas (nationwide — large file, ~15MB).
   * Filter to a bounding box using filterByBbox() after fetching.
   */
  zctas(): Promise<GeoJsonFeatureCollection> {
    // ZCTA file uses "zcta520" naming (2020 ZCTA vintage)
    return this.fetch(nationUrl('zcta520'))
  }

  /**
   * Congressional districts (119th Congress) for a state.
   * @param stateFips - state FIPS, abbreviation, or full name
   */
  congressionalDistricts(stateFips: string): Promise<GeoJsonFeatureCollection> {
    const fips = resolveStateFips(stateFips)
    return this.fetch(stateUrl(fips, 'cd119'))
  }

  /**
   * Unified school districts for a state.
   * @param stateFips - state FIPS, abbreviation, or full name
   */
  unifiedSchoolDistricts(stateFips: string): Promise<GeoJsonFeatureCollection> {
    const fips = resolveStateFips(stateFips)
    return this.fetch(stateUrl(fips, 'unsd'))
  }

  /**
   * Elementary school districts for a state.
   * @param stateFips - state FIPS, abbreviation, or full name
   */
  elementarySchoolDistricts(stateFips: string): Promise<GeoJsonFeatureCollection> {
    const fips = resolveStateFips(stateFips)
    return this.fetch(stateUrl(fips, 'elsd'))
  }

  /**
   * Secondary school districts for a state.
   * @param stateFips - state FIPS, abbreviation, or full name
   */
  secondarySchoolDistricts(stateFips: string): Promise<GeoJsonFeatureCollection> {
    const fips = resolveStateFips(stateFips)
    return this.fetch(stateUrl(fips, 'scsd'))
  }

  /**
   * State legislative districts — lower chamber (state house).
   * @param stateFips - state FIPS, abbreviation, or full name
   */
  stateLowerDistricts(stateFips: string): Promise<GeoJsonFeatureCollection> {
    const fips = resolveStateFips(stateFips)
    return this.fetch(stateUrl(fips, 'sldl'))
  }

  /**
   * State legislative districts — upper chamber (state senate).
   * @param stateFips - state FIPS, abbreviation, or full name
   */
  stateUpperDistricts(stateFips: string): Promise<GeoJsonFeatureCollection> {
    const fips = resolveStateFips(stateFips)
    return this.fetch(stateUrl(fips, 'sldu'))
  }

  // ── Generic level dispatch ────────────────────────────────────────────────────

  /**
   * Fetch any outer level by name. Convenience wrapper over the typed methods.
   */
  outerLevel(level: OuterLevel, stateFips?: string): Promise<GeoJsonFeatureCollection> {
    switch (level) {
      case 'state':   return this.states()
      case 'county':  return this.counties(stateFips)
      case 'place':   return this.places(stateFips ?? throwMissing('stateFips', level))
      case 'cousub':  return this.countySubdivisions(stateFips ?? throwMissing('stateFips', level))
    }
  }

  /**
   * Fetch any inner level by name. Convenience wrapper over the typed methods.
   */
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

  /**
   * Filter a fetched FeatureCollection to features whose bounding box overlaps
   * the given [west, south, east, north] extent. Useful for trimming large
   * national files (e.g. ZCTAs) to a study area.
   */
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

  /**
   * Clip a FeatureCollection to features that intersect a named state.
   * Useful after fetching a national file (counties, ZCTAs).
   */
  filterByState(fc: GeoJsonFeatureCollection, stateFips: string): GeoJsonFeatureCollection {
    const fips = resolveStateFips(stateFips)
    return filterFeatures(
      fc,
      (f) =>
        String(f.properties?.['STATEFP'] ?? '') === fips ||
        String(f.properties?.['STATE'] ?? '') === fips,
    )
  }

  // ── Cache management ──────────────────────────────────────────────────────────

  /** Remove all cached responses. */
  clearCache(): void {
    this.memCache.clear()
    if (this.useSessionCache && typeof sessionStorage !== 'undefined') {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith('lv_geo_'))
        .forEach((k) => sessionStorage.removeItem(k))
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────────

  private async fetch(targetUrl: string): Promise<GeoJsonFeatureCollection> {
    const cacheKey = targetUrl

    // 1. Memory cache
    const mem = this.memCache.get(cacheKey)
    if (mem) return mem

    // 2. Session cache
    if (this.useSessionCache && typeof sessionStorage !== 'undefined') {
      const stored = sessionStorage.getItem(`lv_geo_${cacheKey}`)
      if (stored) {
        const parsed = JSON.parse(stored) as GeoJsonFeatureCollection
        this.memCache.set(cacheKey, parsed)
        return parsed
      }
    }

    // 3. Network
    const data = await this.fetcher(targetUrl)
    this.memCache.set(cacheKey, data)

    if (this.useSessionCache && typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem(`lv_geo_${cacheKey}`, JSON.stringify(data))
      } catch {
        // Storage quota exceeded — silently skip
      }
    }

    return data
  }
}

// ─── Default fetcher ──────────────────────────────────────────────────────────

async function defaultFetcher(targetUrl: string): Promise<GeoJsonFeatureCollection> {
  const res = await fetch(targetUrl)
  if (!res.ok) {
    throw new Error(
      `[LocalVision] Failed to fetch boundary: ${res.status} ${res.statusText}\n  URL: ${targetUrl}`,
    )
  }
  return res.json() as Promise<GeoJsonFeatureCollection>
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
