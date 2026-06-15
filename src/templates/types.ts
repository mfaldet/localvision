import type { ColorSchemeName } from '../views/OuterCityView'

/**
 * Curated dashboard configuration. Each template encodes:
 *   - what ACS variables to fetch
 *   - which one drives the choropleth on first paint
 *   - a sensible color scheme (sequential / diverging)
 *   - default boundary level
 *
 * Templates are consumed by LocalVisionApp.fromTemplate (or by user
 * code that wants to bootstrap a domain-specific dashboard quickly).
 */
export interface DashboardTemplate {
  /** Stable id, used as the `name` arg to fromTemplate. */
  id: string
  label: string
  /** One-sentence description of the dashboard's focus. */
  description: string
  /** ACS variable keys (from CENSUS_VARIABLES) to include. */
  variables: string[]
  /** First-paint active KPI; should be in `variables`. */
  activeKpi: string
  /** Default color scheme for the choropleth. */
  colorScheme: ColorSchemeName
  /** Default boundary level for the Outer view (county / place / cousub). */
  defaultOuterBoundary: 'county' | 'place' | 'cousub'
  /** Default boundary level for the Inner view (tract / bg). */
  defaultInnerBoundary: 'tract' | 'bg'
}
