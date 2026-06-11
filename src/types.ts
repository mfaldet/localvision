import type { StyleSpecification } from 'maplibre-gl'
import type { OuterLevel, InnerLevel } from './geo/levels'

// ─── Geo ──────────────────────────────────────────────────────────────────────

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
}

export interface GeoJsonFeature {
  type: 'Feature'
  geometry: GeoJsonGeometry
  properties: Record<string, unknown>
  id?: string | number
}

export type GeoJsonGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }
  | { type: 'Point'; coordinates: number[] }
  | { type: 'LineString'; coordinates: number[][] }

// ─── KPI data ─────────────────────────────────────────────────────────────────

export type KpiFormat = 'number' | 'percent' | 'currency' | 'rate'

export interface KpiSeries {
  /** Machine-readable identifier, used for cross-linking */
  id: string
  label: string
  format?: KpiFormat
  unit?: string
  /** Ordered array of data points */
  data: KpiDataPoint[]
}

export interface KpiDataPoint {
  /** Category label (e.g. year, neighborhood name, age bracket) */
  category: string | number
  value: number
  /** Optional second dimension for scatter plots */
  value2?: number
}

// ─── Layer configuration ──────────────────────────────────────────────────────

export type LayerType = 'fill' | 'line' | 'circle' | 'symbol'

export interface LayerConfig {
  id: string
  type: LayerType
  /** GeoJSON source or a URL to a GeoJSON file */
  source: GeoJsonFeatureCollection | string
  /** MapLibre paint properties */
  paint?: Record<string, unknown>
  /** MapLibre layout properties */
  layout?: Record<string, unknown>
  /** Property name used to color-encode features */
  colorProperty?: string
  colorScale?: string[]
  visible?: boolean
  opacity?: number
}

// ─── Chart configuration ──────────────────────────────────────────────────────

export type ChartType = 'bar' | 'line' | 'area' | 'scatter' | 'donut'

export interface ChartConfig {
  type: ChartType
  kpiId: string
  title?: string
  /** Override inferred color from theme */
  color?: string
  height?: number
}

// ─── View options ─────────────────────────────────────────────────────────────

export interface MapOptions {
  style?: string | StyleSpecification
  center?: [number, number]
  zoom?: number
  bearing?: number
  pitch?: number
}

export interface InnerCityOptions {
  /** CSS selector or HTMLElement to mount into */
  container: string | HTMLElement
  /** GeoJSON defining the community boundary */
  boundary: GeoJsonFeatureCollection
  /** KPI data series for this community */
  kpis: KpiSeries[]
  /** Charts to render in the panel; order determines layout order */
  charts?: ChartConfig[]
  /** Additional map layers beyond the boundary fill */
  layers?: LayerConfig[]
  map?: MapOptions
  theme?: ThemeOverrides
  /** Split ratio: map fraction of total width (0–1, default 0.5) */
  splitRatio?: number
}

export interface CommunityRecord {
  id: string
  label: string
  /** GeoJSON for this community */
  geojson: GeoJsonFeatureCollection
  kpis: Record<string, number>
  /** Metadata fields shown in tooltip / detail panel */
  meta?: Record<string, string | number>
}

export interface OuterCityOptions {
  container: string | HTMLElement
  /**
   * Hand-built community records. Either `communities` OR `binding` must be
   * provided. Mostly retained for quick demos; for real data use `binding`.
   */
  communities?: CommunityRecord[]
  /**
   * Boundary GeoJSON + tabular data joined by GEOID (from
   * `bindDataToBoundaries`). When provided, takes precedence over
   * `communities` and auto-derives `kpiDefs` from the table's variables.
   */
  binding?: import('./data/types').DataBinding
  /** Which KPI property drives the choropleth color */
  activeKpi: string
  /** KPI definitions. Optional when `binding` is provided (auto-derived). */
  kpiDefs?: KpiDefinition[]
  charts?: ChartConfig[]
  map?: MapOptions
  theme?: ThemeOverrides
  splitRatio?: number
  /** When provided, KPI pills render here instead of an internal header bar */
  headerEl?: HTMLElement
  /**
   * When true, the chart panel is hidden and the map takes the full width.
   * Used by the comparison-mode side-by-side layout.
   */
  mapOnly?: boolean
  /**
   * Shared selection store for cross-component linking. When omitted, the
   * view creates an internal store. Pass `LocalVisionApp`'s selection store
   * here to link this view with other components.
   */
  selection?: import('./state/selection').SelectionStore
  /**
   * When provided, the detail panel shows a "Drill into" button. Called
   * with the selected community's id, label, and feature properties.
   */
  onDrillRequest?: (community: { id: string; label: string; properties: Record<string, unknown> }) => void
  /**
   * Optional label for the drill button, e.g. "Drill into tracts".
   * Default: "Drill into [community label]".
   */
  drillButtonLabel?: string
}

// ─── Combined app ─────────────────────────────────────────────────────────────

export type ViewMode = 'inner' | 'outer'

export interface BoundaryContext {
  /** State FIPS, abbreviation, or full name (e.g. '27', 'MN', 'Minnesota') */
  stateFips: string
  /** Optional county FIPS filter for tract/block-group fetches */
  countyFips?: string
}

export interface LocalVisionAppOptions {
  container: string | HTMLElement
  defaultView?: ViewMode
  /** Starting boundary level for inner city view (default: 'tract') */
  defaultInnerBoundary?: InnerLevel
  /** Starting boundary level for outer city view (default: 'county') */
  defaultOuterBoundary?: OuterLevel
  /**
   * When set, the app auto-fetches Census boundaries for this state whenever
   * the boundary dropdown changes, and overlays them on the active map.
   */
  boundaryContext?: BoundaryContext
  /**
   * Options for InnerCityView. Optional in city-first mode (with
   * `drillProvider`) — the Inner view becomes a finer-scope OuterCityView
   * once the user clicks "+ Inner City" and triggers its first fetch.
   */
  inner?: Omit<InnerCityOptions, 'container'>
  /**
   * Options for OuterCityView. `binding` and `communities` are optional in
   * city-first mode — they get supplied via `drillProvider` after the user
   * picks a city.
   */
  outer: Omit<OuterCityOptions, 'container' | 'headerEl'>
  theme?: ThemeOverrides
  /**
   * Drill-down configuration. When provided, the OuterCityView shows a
   * "Drill into" button in the detail panel and a breadcrumb appears above
   * the chart panel. The library calls drillProvider to fetch each new
   * level's binding; users decide what "drilling" means by what they return.
   */
  drillProvider?: import('./state/drilldown').DrillProvider
  /**
   * Initial root entry for the drill-down stack. Sets the breadcrumb's root
   * label. If omitted, a sensible default is derived from
   * `defaultOuterBoundary` + `boundaryContext`.
   */
  rootDrilldownLevel?: import('./state/drilldown').DrilldownLevel
}

export interface KpiDefinition {
  id: string
  label: string
  format?: KpiFormat
  unit?: string
  colorScale?: string[]
  /**
   * Geographic levels where this KPI has data. Used by views to filter the
   * KPI picker — e.g. don't offer a county-only metric when looking at
   * census tracts. Undefined / empty = available at every level.
   */
  availableAtLevels?: string[]
}

// ─── Theme ────────────────────────────────────────────────────────────────────

export interface ThemeOverrides {
  fontFamily?: string
  colorPrimary?: string
  colorAccent?: string
  colorBackground?: string
  colorSurface?: string
  colorText?: string
  colorTextMuted?: string
  borderRadius?: string
  mapStyle?: string | StyleSpecification
}

// ─── Events ───────────────────────────────────────────────────────────────────

export interface FeatureSelectEvent {
  featureId: string | number | null
  properties: Record<string, unknown>
  lngLat: [number, number]
}

export interface KpiSelectEvent {
  kpiId: string
}

export interface BoundaryChangeEvent {
  boundary: OuterLevel | InnerLevel
  view: ViewMode
}

export type LocalVisionEventMap = {
  featureSelect: FeatureSelectEvent
  featureDeselect: never
  kpiSelect: KpiSelectEvent
  boundaryChange: BoundaryChangeEvent
}
