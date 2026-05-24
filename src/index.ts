export { InnerCityView } from './views/InnerCityView'
export { OuterCityView, COLOR_SCHEMES } from './views/OuterCityView'
export type { ChoroplethStyleConfig, ColorSchemeName, LinePatternName } from './views/OuterCityView'

// ─── Custom map layers (Bundle 5) ────────────────────────────────────────────
export { LAYER_PRESETS, PRESET_IDS, fetchOverpassGeoJson, osmJsonToGeoJson } from './layers/index'
export type { LayerPreset, LayerType, OverpassFetchOptions } from './layers/index'
export { LocalVisionApp } from './views/LocalVisionApp'

export type {
  InnerCityOptions,
  OuterCityOptions,
  LocalVisionAppOptions,
  BoundaryContext,
  ViewMode,
  CommunityRecord,
  KpiSeries,
  KpiDataPoint,
  KpiDefinition,
  KpiFormat,
  ChartConfig,
  ChartType,
  LayerConfig,
  LayerType,
  MapOptions,
  GeoJsonFeatureCollection,
  GeoJsonFeature,
  GeoJsonGeometry,
  ThemeOverrides,
  FeatureSelectEvent,
  KpiSelectEvent,
  BoundaryChangeEvent,
  LocalVisionEventMap,
} from './types'

export { DEFAULT_THEME } from './theme/tokens'
export type { ResolvedTheme } from './theme/tokens'

export {
  BoundaryLoader,
  LEVEL_META,
  STATES,
  resolveStateFips,
  padCountyFips,
  getStateMeta,
  stripLsadSuffix,
  bbox,
  bboxCenter,
  pointInPolygon,
  findFeatureContaining,
} from './geo/index'
export type {
  BoundaryLoaderOptions,
  CacheStats,
  PlaceIndexEntry,
  BBox,
  OuterLevel,
  InnerLevel,
  AnyLevel,
  LevelMeta,
  StateMeta,
} from './geo/index'

// ─── Cross-filtering (Bundle 2) ──────────────────────────────────────────────
export { SelectionStore } from './state/selection'
export type { SelectionState, SelectionMode, SelectionListener } from './state/selection'

// ─── Drill-down (Bundle 3) ───────────────────────────────────────────────────
export { DrilldownStore, parseGeoId } from './state/drilldown'
export type {
  DrilldownLevel,
  DrilldownEntry,
  DrilldownState,
  DrilldownListener,
  DrillTarget,
  DrillProvider,
} from './state/drilldown'

// ─── Time dimension (Bundle 4) ───────────────────────────────────────────────
export { TimeStore } from './state/time'
export type { TimeState, TimeListener, TimeValue } from './state/time'

// ─── Data Foundation (Bundle 1) ──────────────────────────────────────────────
export {
  CensusACS,
  CENSUS_VARIABLES,
  CATEGORIES,
  resolveVariable,
  variablesByCategory,
  bindDataToBoundaries,
  stripAcsGeoIdPrefix,
  cleanCommunityName,
  isVariableAvailableAtLevel,
  parseCsv,
  loadCsv,
} from './data/index'
export type {
  CensusACSOptions,
  AcsFetchParams,
  AcsGeography,
  AcsGeographyLevel,
  VariableMeta,
  VariableCategory,
  GeographicLevel,
  BindOptions,
  ParseCsvOptions,
  DataTable,
  DataRow,
  DataBinding,
} from './data/index'
