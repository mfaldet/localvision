/**
 * Bind tabular data (from ACS, CSV, or a custom adapter) to Census boundary
 * GeoJSON via the GEOID property. Returns a DataBinding whose `boundaries`
 * have the data values merged into each feature's `properties`, ready for
 * direct consumption by views and map layers.
 */

import type { GeoJsonFeatureCollection, GeoJsonFeature } from '../types'
import type { DataTable, DataBinding } from './types'
import { cleanCommunityName } from './labels'

export interface BindOptions {
  /** Property name on each feature that matches DataRow.geoid. */
  geoidProperty?: string
  /**
   * Transform applied to raw feature property values before lookup.
   * Default: identity. Use this when source GEOIDs need normalization
   * (stripping prefixes, padding, etc.).
   */
  geoidTransform?: (raw: string) => string
}

const COMMON_GEOID_PROPS = ['GEOID', 'GEO_ID', 'geoid', 'GEOID20', 'GEOID10']

export function bindDataToBoundaries(
  boundaries: GeoJsonFeatureCollection,
  table: DataTable,
  options: BindOptions = {},
): DataBinding {
  const geoidProp = options.geoidProperty ?? autoDetectGeoidProperty(boundaries)
  const transform = options.geoidTransform ?? identity

  const byGeoid = new Map(table.rows.map((r) => [r.geoid, r]))

  const features: GeoJsonFeature[] = boundaries.features.map((f) => {
    const raw = String(f.properties?.[geoidProp] ?? '')
    const geoid = transform(raw)
    const row = byGeoid.get(geoid)

    const merged: Record<string, unknown> = { ...f.properties, _lv_geoid: geoid }
    const level = table.meta?.geographyLevel
    const rawLabel = row?.name ?? (f.properties?.['NAME'] as string | undefined)
    merged['_lv_label'] = rawLabel
      ? cleanCommunityName(rawLabel, level)
      : geoid
    if (row) {
      for (const [k, v] of Object.entries(row.values)) {
        if (v !== null) merged[k] = v
      }
    }

    return { ...f, properties: merged }
  })

  return {
    boundaries: { type: 'FeatureCollection', features },
    table,
    geoidProperty: geoidProp,
  }
}

function autoDetectGeoidProperty(fc: GeoJsonFeatureCollection): string {
  const first = fc.features[0]
  if (!first?.properties) return 'GEOID'
  for (const prop of COMMON_GEOID_PROPS) {
    if (prop in first.properties) return prop
  }
  return 'GEOID'
}

function identity(x: string): string {
  return x
}

/**
 * Strip Census API ACS GEO_ID prefixes (e.g. "0500000US27053" → "27053").
 * Use with BindOptions.geoidTransform when joining ACS data fetched as
 * GEO_ID (rather than reconstructed via the geography fields, which our
 * ACS client already does for you).
 */
export function stripAcsGeoIdPrefix(raw: string): string {
  const i = raw.indexOf('US')
  return i >= 0 ? raw.slice(i + 2) : raw
}
