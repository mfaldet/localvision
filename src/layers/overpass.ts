/**
 * Tiny Overpass API client + OSM→GeoJSON converter. Just enough to fetch
 * point + way features inside a bounding box for the preset overlays
 * (parks, schools, transit stops, hospitals).
 *
 * Not a full OSM-to-GeoJSON implementation — relations, multipolygons,
 * and tag preservation are minimal. For richer needs, swap in the
 * upstream `osmtogeojson` library.
 *
 * Overpass etiquette: cache aggressively (per bbox+query), back off on
 * 429, and surface a meaningful error on failure.
 */

import type { GeoJsonFeatureCollection, GeoJsonFeature, GeoJsonGeometry } from '../types'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

export interface OverpassFetchOptions {
  /** Bounding box: [south, west, north, east] in WGS84. */
  bbox: [number, number, number, number]
  /**
   * Overpass QL element-and-filter fragment, e.g. `way[leisure=park]`
   * or `node[amenity=school]`. Wrapped automatically with the bbox +
   * the `out geom` request.
   */
  query: string
  /** Timeout in seconds passed to Overpass. Default 25. */
  timeoutSec?: number
  /** Optional signal for cancellation. */
  signal?: AbortSignal
}

/**
 * Fetch features from Overpass and return them as a GeoJSON
 * FeatureCollection. Throws with a descriptive message on failure.
 */
export async function fetchOverpassGeoJson(
  opts: OverpassFetchOptions,
): Promise<GeoJsonFeatureCollection> {
  const [s, w, n, e] = opts.bbox
  const timeoutSec = opts.timeoutSec ?? 25
  const ql = `[out:json][timeout:${timeoutSec}][bbox:${s},${w},${n},${e}];(${opts.query};);out geom;`
  const body = new URLSearchParams({ data: ql }).toString()

  let res: Response
  try {
    res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: opts.signal,
    })
  } catch (err) {
    throw new Error(
      `[LocalVision] Overpass network error\n  Query: ${opts.query}\n  Cause: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (!res.ok) {
    throw new Error(
      `[LocalVision] Overpass HTTP ${res.status} ${res.statusText}\n  Query: ${opts.query}`,
    )
  }
  const json = (await res.json()) as OsmJsonResponse
  if (!json.elements) {
    throw new Error(`[LocalVision] Overpass returned unexpected response shape for: ${opts.query}`)
  }
  return osmJsonToGeoJson(json)
}

// ─── OSM JSON → GeoJSON ──────────────────────────────────────────────────────

interface OsmJsonNode {
  type: 'node'
  id: number
  lat: number
  lon: number
  tags?: Record<string, string>
}
interface OsmJsonWay {
  type: 'way'
  id: number
  nodes?: number[]
  geometry?: { lat: number; lon: number }[]
  tags?: Record<string, string>
}
interface OsmJsonRelation {
  type: 'relation'
  id: number
  tags?: Record<string, string>
}
type OsmJsonElement = OsmJsonNode | OsmJsonWay | OsmJsonRelation
interface OsmJsonResponse {
  elements?: OsmJsonElement[]
}

/**
 * Convert Overpass's OSM JSON (with `out geom`) into a GeoJSON
 * FeatureCollection. Handles:
 *   - nodes      → Point
 *   - ways       → Polygon when closed, LineString otherwise
 *   - relations  → skipped (not enough info from `out geom` alone)
 */
export function osmJsonToGeoJson(json: OsmJsonResponse): GeoJsonFeatureCollection {
  const features: GeoJsonFeature[] = []
  for (const el of json.elements ?? []) {
    if (el.type === 'node') {
      features.push({
        type: 'Feature',
        properties: { osm_id: el.id, ...(el.tags ?? {}) },
        geometry: { type: 'Point', coordinates: [el.lon, el.lat] },
      })
    } else if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2) {
      const coords = el.geometry.map((p) => [p.lon, p.lat] as [number, number])
      const first = coords[0]
      const last = coords[coords.length - 1]
      const isClosed =
        coords.length >= 4 && first[0] === last[0] && first[1] === last[1]
      let geom: GeoJsonGeometry
      if (isClosed) {
        geom = { type: 'Polygon', coordinates: [coords] }
      } else {
        geom = { type: 'LineString', coordinates: coords }
      }
      features.push({
        type: 'Feature',
        properties: { osm_id: el.id, ...(el.tags ?? {}) },
        geometry: geom,
      })
    }
    // Relations skipped — they typically need stitching from their members,
    // which requires fetching member geometries we don't have here.
  }
  return { type: 'FeatureCollection', features }
}
