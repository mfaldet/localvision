/**
 * Vector-tile boundary source helpers.
 *
 * For nation-scale dashboards, loading boundary geometry as GeoJSON is
 * expensive — a single state's block groups can be several MB, and the
 * whole country is impractical. The scalable alternative is Mapbox
 * Vector Tiles (MVT): the map only requests tiles for the current
 * viewport + zoom, and data is joined to tile features at render time
 * via MapLibre's feature-state.
 *
 * LocalVision doesn't host a tile server, so this is a BYO-tiles helper:
 * you point it at your own MVT endpoint (or a hosted Census tileset) and
 * it builds the MapLibre source/layer config + the data-join expression
 * for you.
 *
 * The canonical free option is the US Census's own vector tiles, or
 * self-hosting via tippecanoe + a tile server like martin / tileserver-gl.
 */

import type { DataTable } from '../data/types'

export interface VectorBoundaryConfig {
  /**
   * Tile URL template, e.g.
   *   'https://your-server/tiles/tracts/{z}/{x}/{y}.pbf'
   */
  tiles: string[]
  /** The source-layer name inside the vector tiles (set by your tiler). */
  sourceLayer: string
  /**
   * Feature property in the tiles that holds the GEOID. MapLibre will
   * `promoteId` this so feature-state joins work.
   */
  geoidProperty?: string
  minzoom?: number
  maxzoom?: number
}

/**
 * Build the MapLibre `addSource` argument for a vector boundary source.
 * Pass the result to `map.addSource(id, buildVectorSource(config))`.
 */
export function buildVectorSource(config: VectorBoundaryConfig): Record<string, unknown> {
  return {
    type: 'vector',
    tiles: config.tiles,
    minzoom: config.minzoom ?? 0,
    maxzoom: config.maxzoom ?? 14,
    // promoteId lifts the GEOID property to the feature id so we can
    // address features by GEOID in setFeatureState.
    promoteId: config.geoidProperty ?? 'GEOID',
  }
}

/**
 * Apply a DataTable's values to vector-tile features via feature-state.
 * Each row's `values` are written onto the feature whose id matches the
 * row's geoid. The choropleth paint expression then reads
 * `['feature-state', kpiKey]` instead of `['get', kpiKey]`.
 *
 * Call this on every `sourcedata` event (tiles load progressively as the
 * user pans), so newly-loaded features pick up their data.
 *
 * @returns the set of geoids that were applied (useful for debugging
 *          coverage gaps between your tiles and your data).
 */
export function applyDataToVectorTiles(
  map: {
    setFeatureState: (
      feature: { source: string; sourceLayer: string; id: string | number },
      state: Record<string, unknown>,
    ) => void
  },
  sourceId: string,
  sourceLayer: string,
  table: DataTable,
  time?: string | number,
): Set<string> {
  const applied = new Set<string>()
  for (const row of table.rows) {
    // Skip rows that don't match the requested time for temporal tables.
    if (time != null && row.time != null && row.time !== time) continue
    map.setFeatureState(
      { source: sourceId, sourceLayer, id: row.geoid },
      { ...row.values },
    )
    applied.add(row.geoid)
  }
  return applied
}

/**
 * Build a choropleth fill-color expression that reads from feature-state
 * (vector-tile mode) rather than feature properties (GeoJSON mode).
 *
 * @param kpiKey   the variable to color by
 * @param stops    [value, color] interpolation stops
 */
export function vectorChoroplethExpression(
  kpiKey: string,
  stops: [number, string][],
): unknown[] {
  const flat: (number | string)[] = []
  for (const [value, color] of stops) flat.push(value, color)
  return [
    'interpolate',
    ['linear'],
    ['coalesce', ['feature-state', kpiKey], 0],
    ...flat,
  ]
}
