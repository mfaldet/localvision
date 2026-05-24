/**
 * OSM-backed map layer presets for LocalVision.
 *
 * Each preset defines:
 *   - id / label             — used in the layer panel
 *   - overpassQuery          — Overpass QL filter (e.g. `way[leisure=park]`)
 *   - geometryType           — 'fill' for polygons, 'circle' for points,
 *                              'line' for linear features
 *   - paint / layout         — MapLibre paint props for the visual style
 *
 * To add a preset: declare a new entry here. The settings panel picks it
 * up automatically by iterating LAYER_PRESETS.
 *
 * Coverage is intentionally narrow in v1 — Parks, Schools, Transit
 * stops, Hospitals. Each maps to a single OSM tag so the queries stay
 * fast (Overpass charges by complexity). Custom user layers via
 * LocalVisionApp.addCustomLayer cover anything else.
 */

export type LayerType = 'fill' | 'line' | 'circle'

export interface LayerPreset {
  id: string
  label: string
  /** OSM tag(s) translated to Overpass QL element-and-filter fragments. */
  overpassQuery: string
  type: LayerType
  /** Default MapLibre paint props. Opacity is overridden by the panel slider. */
  paint: Record<string, unknown>
  /** Optional default visibility (true to enable on first load). */
  defaultVisible?: boolean
}

export const LAYER_PRESETS: Record<string, LayerPreset> = {
  parks: {
    id: 'parks',
    label: 'Parks',
    // way [leisure=park] OR way [leisure=garden] catches both formally
    // designated parks and most park-like green spaces.
    overpassQuery: 'way[leisure~"^(park|garden|nature_reserve)$"]',
    type: 'fill',
    paint: {
      'fill-color': '#22c55e',
      'fill-opacity': 0.35,
      'fill-outline-color': '#15803d',
    },
  },
  schools: {
    id: 'schools',
    label: 'Schools',
    // Both nodes (point) and ways (building polygon) tagged amenity=school.
    overpassQuery: 'nwr[amenity=school]',
    type: 'circle',
    paint: {
      'circle-color': '#f59e0b',
      'circle-radius': 4,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
    },
  },
  transit: {
    id: 'transit',
    label: 'Transit stops',
    // Bus + rail stop positions. Excludes platforms / shelters / etc.
    overpassQuery: 'node[public_transport=stop_position]',
    type: 'circle',
    paint: {
      'circle-color': '#a78bfa',
      'circle-radius': 3,
      'circle-stroke-color': '#5b21b6',
      'circle-stroke-width': 1,
    },
  },
  hospitals: {
    id: 'hospitals',
    label: 'Hospitals',
    overpassQuery: 'nwr[amenity=hospital]',
    type: 'circle',
    paint: {
      'circle-color': '#ef4444',
      'circle-radius': 5,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
    },
  },
}

export const PRESET_IDS = Object.keys(LAYER_PRESETS)
