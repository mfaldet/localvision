import type { GeoJsonFeatureCollection } from '../types'
import type { VariableMeta } from './variables'

/**
 * A single row of data keyed to a Census geography.
 *
 * `geoid` matches the GEOID property on Census cartographic boundary features
 * (e.g. "27053" for Hennepin County, MN; "27053000100" for a specific tract).
 */
export interface DataRow {
  geoid: string
  /** Optional human-readable name (typically from ACS `NAME` field). */
  name?: string
  /** Variable values keyed by VariableMeta.key (NOT the raw ACS code). */
  values: Record<string, number | null>
  /**
   * Optional time-point this row represents. When DataTable.timeAxis is set,
   * the table is expected to contain one row per (geoid, time) pair.
   */
  time?: string | number
}

export interface DataTable {
  /** Definitions of every variable present in the rows. */
  variables: VariableMeta[]
  rows: DataRow[]
  /**
   * Source-of-truth metadata for citation, caching, debugging.
   */
  meta?: {
    source?: string          // e.g. 'Census ACS 5-year'
    year?: number
    geographyLevel?: string  // 'county', 'tract', etc.
    fetchedAt?: string       // ISO timestamp
  }
  /**
   * Time-axis metadata. When present, the table holds time-varying data and
   * views with time support animate through it via TimeStore. Each row should
   * have a `time` field matching one of `times`.
   */
  timeAxis?: {
    /** Ordered timeline values (e.g. [2018, 2019, 2020]). */
    times: (string | number)[]
    /** Optional label for the time axis (e.g. "Year"). */
    label?: string
  }
}

/**
 * A DataBinding pairs Census boundary GeoJSON with a tabular DataTable joined
 * by GEOID. The boundaries are re-emitted with the data values merged into
 * each feature's `properties` for direct use with map layers.
 */
export interface DataBinding {
  boundaries: GeoJsonFeatureCollection
  table: DataTable
  /** Property name on each feature that matches DataRow.geoid. */
  geoidProperty: string
}
