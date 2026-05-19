/**
 * Census ACS 5-year Estimates API client.
 *
 * Source: https://api.census.gov/data/{year}/acs/acs5
 * Docs:   https://www.census.gov/data/developers/data-sets/acs-5year.html
 *
 * No API key required for small queries (< 500/day), but a free key is
 * recommended for higher volume. Get one at:
 *   https://api.census.gov/data/key_signup.html
 */

import { resolveStateFips, padCountyFips } from '../geo/fips'
import { resolveVariable, type VariableMeta } from './variables'
import type { DataTable, DataRow } from './types'

// ─── Public types ─────────────────────────────────────────────────────────────

export type AcsGeographyLevel =
  | 'state'
  | 'county'
  | 'tract'
  | 'bg'
  | 'place'
  | 'cousub'

export interface AcsGeography {
  /** State FIPS, abbreviation, or full name. Omit for nation-wide state-level pulls. */
  state?: string
  level: AcsGeographyLevel
  /** Optional county FIPS filter (only relevant for tract / bg). */
  county?: string
}

export interface AcsFetchParams {
  /** Variable catalog keys OR raw ACS codes (e.g. 'B19013_001E'). */
  variables: string[]
  geography: AcsGeography
  /** ACS 5-year endpoint year. Defaults to the constructor year. */
  year?: number
}

export interface CensusACSOptions {
  /** Census API key. Optional for low-volume use. */
  apiKey?: string
  /** Default endpoint year. Defaults to 2022. */
  year?: number
  /** Persist responses in sessionStorage. Default false. */
  sessionCache?: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = 'https://api.census.gov/data'
const DEFAULT_YEAR = 2022
const DATASET = 'acs/acs5'

// ─── CensusACS ────────────────────────────────────────────────────────────────

export class CensusACS {
  private apiKey?: string
  private year: number
  private useSessionCache: boolean
  private memCache = new Map<string, DataTable>()

  constructor(options: CensusACSOptions = {}) {
    this.apiKey = options.apiKey?.trim() || undefined
    this.year = options.year ?? DEFAULT_YEAR
    this.useSessionCache = options.sessionCache ?? false
  }

  async fetch(params: AcsFetchParams): Promise<DataTable> {
    const year = params.year ?? this.year
    const resolved = params.variables.map((v) => resolveVariable(v))

    // Filter out stub entries (categories ACS doesn't cover)
    const fetchable = resolved.filter((v) => !v.unavailable && v.code)
    if (fetchable.length === 0) {
      throw new Error('[LocalVision] No fetchable ACS variables in request — all entries are unavailable stubs.')
    }
    if (fetchable.length < resolved.length) {
      console.warn(
        `[LocalVision] Skipped ${resolved.length - fetchable.length} unavailable variable(s); see their .notes for external sources.`,
      )
    }

    const url = this.buildUrl(year, fetchable, params.geography)
    const cacheKey = url

    const mem = this.memCache.get(cacheKey)
    if (mem) return mem
    const stored = this.readSession(cacheKey)
    if (stored) {
      this.memCache.set(cacheKey, stored)
      return stored
    }

    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(
        `[LocalVision] Census ACS request failed: HTTP ${res.status}\n  URL: ${url}`,
      )
    }

    const raw = (await res.json()) as string[][]
    if (!Array.isArray(raw) || raw.length < 1) {
      throw new Error('[LocalVision] Census ACS returned unexpected response shape.')
    }

    const table = this.parseResponse(raw, fetchable, params.geography, year)
    this.memCache.set(cacheKey, table)
    this.writeSession(cacheKey, table)
    return table
  }

  clearCache(): void {
    this.memCache.clear()
    if (this.useSessionCache && typeof sessionStorage !== 'undefined') {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith('lv_acs_'))
        .forEach((k) => sessionStorage.removeItem(k))
    }
  }

  // ── URL construction ────────────────────────────────────────────────────────

  private buildUrl(year: number, vars: VariableMeta[], geo: AcsGeography): string {
    const codes = vars.map((v) => v.code).join(',')
    const getParam = `NAME,${codes}`
    const { forClause, inClause } = this.buildGeoClauses(geo)

    const params = new URLSearchParams()
    params.set('get', getParam)
    params.set('for', forClause)
    if (inClause) params.set('in', inClause)
    if (this.apiKey) params.set('key', this.apiKey)

    return `${BASE_URL}/${year}/${DATASET}?${params.toString()}`
  }

  private buildGeoClauses(geo: AcsGeography): { forClause: string; inClause?: string } {
    const stateFips = geo.state ? resolveStateFips(geo.state) : undefined

    switch (geo.level) {
      case 'state':
        return { forClause: 'state:*' }

      case 'county':
        if (!stateFips) return { forClause: 'county:*' }
        return { forClause: 'county:*', inClause: `state:${stateFips}` }

      case 'place':
        if (!stateFips) throw new Error('[LocalVision] ACS place queries require a state.')
        return { forClause: 'place:*', inClause: `state:${stateFips}` }

      case 'cousub':
        if (!stateFips) throw new Error('[LocalVision] ACS cousub queries require a state.')
        return { forClause: 'county subdivision:*', inClause: `state:${stateFips}` }

      case 'tract': {
        if (!stateFips) throw new Error('[LocalVision] ACS tract queries require a state.')
        const inParts = [`state:${stateFips}`]
        if (geo.county) inParts.push(`county:${padCountyFips(geo.county)}`)
        return { forClause: 'tract:*', inClause: inParts.join(' ') }
      }

      case 'bg': {
        if (!stateFips) throw new Error('[LocalVision] ACS block group queries require a state.')
        const inParts = [`state:${stateFips}`]
        if (geo.county) inParts.push(`county:${padCountyFips(geo.county)}`)
        return { forClause: 'block group:*', inClause: inParts.join(' ') }
      }
    }
  }

  // ── Response parsing ────────────────────────────────────────────────────────

  private parseResponse(
    raw: string[][],
    vars: VariableMeta[],
    geo: AcsGeography,
    year: number,
  ): DataTable {
    const headers = raw[0]
    const idxByHeader = new Map(headers.map((h, i) => [h, i]))

    const rows: DataRow[] = raw.slice(1).map((row) => {
      const values: Record<string, number | null> = {}
      for (const v of vars) {
        const i = idxByHeader.get(v.code)
        values[v.key] = i !== undefined ? parseAcsValue(row[i]) : null
      }
      const nameIdx = idxByHeader.get('NAME')
      const name = nameIdx !== undefined ? row[nameIdx] : undefined
      const geoid = buildGeoIdFromRow(row, headers, geo.level)
      return { geoid, name, values }
    })

    return {
      variables: vars,
      rows,
      meta: {
        source: 'Census ACS 5-year',
        year,
        geographyLevel: geo.level,
        fetchedAt: new Date().toISOString(),
      },
    }
  }

  // ── Session cache plumbing ──────────────────────────────────────────────────

  private readSession(key: string): DataTable | undefined {
    if (!this.useSessionCache || typeof sessionStorage === 'undefined') return
    const stored = sessionStorage.getItem(`lv_acs_${key}`)
    return stored ? (JSON.parse(stored) as DataTable) : undefined
  }

  private writeSession(key: string, table: DataTable): void {
    if (!this.useSessionCache || typeof sessionStorage === 'undefined') return
    try {
      sessionStorage.setItem(`lv_acs_${key}`, JSON.stringify(table))
    } catch {
      /* quota exceeded — skip */
    }
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Parse an ACS value cell. ACS uses several sentinel values for missing data
 * (`(X)`, `**`, `*`, large negatives); all map to null.
 */
function parseAcsValue(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null
  const t = raw.trim()
  if (!t || t === '(X)' || t === '**' || t === '*' || t === '-' || t === 'null') return null
  const n = Number(t)
  if (!isFinite(n)) return null
  // ACS encodes "estimate not available" as very large negatives
  if (n < -100_000_000) return null
  return n
}

/**
 * Reconstruct the canonical GEOID for a row from the Census-returned geography
 * fields. The Census API returns geography as separate fields (`state`,
 * `county`, `tract`, etc.); cartographic boundaries use the concatenation.
 */
function buildGeoIdFromRow(
  row: string[],
  headers: string[],
  level: AcsGeographyLevel,
): string {
  const idx = (name: string) => headers.indexOf(name)
  const get = (name: string) => (idx(name) >= 0 ? row[idx(name)] : '')

  switch (level) {
    case 'state':
      return get('state')
    case 'county':
      return get('state') + get('county')
    case 'tract':
      return get('state') + get('county') + get('tract')
    case 'bg':
      return (
        get('state') + get('county') + get('tract') + get('block group')
      )
    case 'place':
      return get('state') + get('place')
    case 'cousub':
      return get('state') + get('county subdivision')
  }
}
