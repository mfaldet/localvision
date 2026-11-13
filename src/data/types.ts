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
   * Optional margins of error for the values, keyed like `values`, in the
   * same units. Views show them beside each figure. In a change period
   * (see `timeAxis.change`) a value no larger than its margin is treated as
   * "no measurable change".
   */
  margins?: Record<string, number | null>
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
    /**
     * A color scale that does not depend on what is on screen, so a color
     * means the same value wherever the visitor looks — for comparing one
     * place with another seen earlier. Views offer it as an alternative to
     * fitting the colors to the current view.
     *
     * `breaks` are ascending values, typically evenly spaced percentiles of
     * a wide reference set (every county in the country, say). The palette
     * is spread evenly across them, so the most color steps fall where most
     * areas are. `changeBreaks` do the same for the size of a percentage
     * change and are used on both sides of zero.
     */
    fixedScale?: {
      /** Short name for the reference set, shown on the switch (e.g. "All US"). */
      label: string
      /** One sentence saying what the fixed colors are measured against. */
      description?: string
      scales: Record<string, { breaks: number[]; changeBreaks?: number[] }>
    }
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
    /**
     * Marks one entry of `times` as a change between periods, not a period.
     * Its values are percentage changes. Views format them as signed
     * percentages, color the map on a diverging scale around zero, and show
     * areas whose change is within its margin of error in a neutral color.
     */
    change?: {
      time: string | number
      /**
       * Cautions to show on the map legend in change mode, keyed by variable
       * key — for a measure whose change needs reading with care.
       */
      notes?: Record<string, string>
    }
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
