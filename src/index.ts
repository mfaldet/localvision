export { InnerCityView } from './views/InnerCityView'
export { OuterCityView } from './views/OuterCityView'
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

export { BoundaryLoader, LEVEL_META, STATES, resolveStateFips, padCountyFips, getStateMeta } from './geo/index'
export type { BoundaryLoaderOptions, OuterLevel, InnerLevel, AnyLevel, LevelMeta, StateMeta } from './geo/index'

// ─── Data Foundation (Bundle 1) ──────────────────────────────────────────────
export {
  CensusACS,
  CENSUS_VARIABLES,
  CATEGORIES,
  resolveVariable,
  variablesByCategory,
  bindDataToBoundaries,
  stripAcsGeoIdPrefix,
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
  BindOptions,
  ParseCsvOptions,
  DataTable,
  DataRow,
  DataBinding,
} from './data/index'
