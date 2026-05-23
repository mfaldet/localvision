/**
 * Curated catalog of Census ACS 5-year variables, organized by category.
 *
 * Categories track the topical buckets LocalVision aims to surface:
 *   community, housing, economy, education, transportation,
 *   health, safety, environment.
 *
 * Where ACS does not directly cover a category (notably safety mortality,
 * disease mortality, and environmental data), the catalog still defines
 * the category and notes the canonical external data source for future
 * integration.
 *
 * All ACS codes use the format `B{table}_{line}E` (estimate). Margins of
 * error (`M` suffix) are intentionally omitted from v1 — we surface
 * estimates only.
 */

import type { KpiFormat } from '../types'

export type VariableCategory =
  | 'community'
  | 'housing'
  | 'economy'
  | 'education'
  | 'transportation'
  | 'health'
  | 'safety'
  | 'environment'

export interface VariableMeta {
  /** Library-stable identifier — used as the KPI key in views. */
  key: string
  /**
   * ACS code (e.g. `B19013_001E`). Empty string for non-ACS placeholder
   * entries that document a category gap.
   */
  code: string
  label: string
  format: KpiFormat
  unit?: string
  category: VariableCategory
  /** Optional description / caveats / source pointer. */
  notes?: string
  /** When true, this entry documents a gap and cannot be fetched from ACS. */
  unavailable?: boolean
  /** External data source recommendation when ACS doesn't cover this. */
  externalSource?: string
  /**
   * Geographic levels at which this variable has data. The KPI picker only
   * shows variables whose `availableAtLevels` includes the active boundary
   * level — so, e.g., a metric that only exists at county granularity won't
   * be offered when you're looking at census tracts.
   *
   * When undefined, treated as "available at every level". All ACS detailed-
   * table variables in the curated catalog are available at the standard
   * ADM levels (state through block group + place, cousub).
   */
  availableAtLevels?: string[]
}

/** All ACS detailed-table levels — the default for curated ACS variables. */
const ALL_ACS_LEVELS = ['state', 'county', 'place', 'cousub', 'tract', 'bg']

// ─── Variable catalog ─────────────────────────────────────────────────────────

export const CENSUS_VARIABLES: Record<string, VariableMeta> = {
  // ── Community / Demographics ──────────────────────────────────────────────
  total_population: {
    key: 'total_population',
    code: 'B01003_001E',
    label: 'Total Population',
    format: 'number',
    category: 'community',
  },
  median_age: {
    key: 'median_age',
    code: 'B01002_001E',
    label: 'Median Age',
    format: 'rate',
    unit: ' yrs',
    category: 'community',
  },

  // ── Housing ────────────────────────────────────────────────────────────────
  median_gross_rent: {
    key: 'median_gross_rent',
    code: 'B25064_001E',
    label: 'Median Gross Rent',
    format: 'currency',
    category: 'housing',
    notes: 'Affordability proxy. Includes contract rent + estimated utilities.',
  },
  median_home_value: {
    key: 'median_home_value',
    code: 'B25077_001E',
    label: 'Median Home Value',
    format: 'currency',
    category: 'housing',
    notes: 'Self-reported value of owner-occupied housing units.',
  },
  total_housing_units: {
    key: 'total_housing_units',
    code: 'B25001_001E',
    label: 'Total Housing Units',
    format: 'number',
    category: 'housing',
    notes: 'Density proxy when combined with land area.',
  },

  // ── Economy ────────────────────────────────────────────────────────────────
  median_household_income: {
    key: 'median_household_income',
    code: 'B19013_001E',
    label: 'Median Household Income',
    format: 'currency',
    category: 'economy',
  },
  per_capita_income: {
    key: 'per_capita_income',
    code: 'B19301_001E',
    label: 'Per Capita Income',
    format: 'currency',
    category: 'economy',
  },
  poverty_count: {
    key: 'poverty_count',
    code: 'B17001_002E',
    label: 'Population Below Poverty',
    format: 'number',
    category: 'economy',
    notes: 'Count. Divide by B17001_001E (population for whom poverty was determined) to get a rate.',
  },

  // ── Education ──────────────────────────────────────────────────────────────
  bachelors_degree_count: {
    key: 'bachelors_degree_count',
    code: 'B15003_022E',
    label: "Bachelor's Degree (age 25+)",
    format: 'number',
    category: 'education',
    notes: "Count of population 25+ whose highest degree is a Bachelor's. For 'Bachelor's or higher', also sum B15003_023E–025E.",
  },

  // ── Transportation ─────────────────────────────────────────────────────────
  workers_drove_alone: {
    key: 'workers_drove_alone',
    code: 'B08006_003E',
    label: 'Workers Who Drove Alone',
    format: 'number',
    category: 'transportation',
    notes: 'Commute mode share. Total workers 16+ is B08006_001E.',
  },
  aggregate_travel_time_to_work: {
    key: 'aggregate_travel_time_to_work',
    code: 'B08013_001E',
    label: 'Aggregate Travel Time to Work',
    format: 'number',
    unit: ' min',
    category: 'transportation',
    notes: 'Sum across all workers. Divide by B08006_001E for mean commute minutes.',
  },

  // ── Health ─────────────────────────────────────────────────────────────────
  no_health_insurance_count: {
    key: 'no_health_insurance_count',
    code: 'B27010_017E',
    label: 'Under 19 — No Health Insurance',
    format: 'number',
    category: 'health',
    notes: 'ACS covers insurance coverage only. For disease incidence / mortality, see CDC NCHS WONDER.',
    externalSource: 'https://wonder.cdc.gov/',
  },

  // ── Safety (ACS GAP — documented stub) ─────────────────────────────────────
  residential_stability: {
    key: 'residential_stability',
    code: 'B07001_017E',
    label: 'Lived in Same House 1 Year Ago',
    format: 'number',
    category: 'safety',
    notes:
      'Weak proxy for residential stability. ACS does NOT publish violent crime or mortality data — see FBI Uniform Crime Reporting (UCR) or local agencies.',
    externalSource: 'https://cde.ucr.cjis.gov/',
  },

  // ── Environment (ACS GAP — pure stub) ──────────────────────────────────────
  tree_canopy_coverage: {
    key: 'tree_canopy_coverage',
    code: '',
    label: 'Tree Canopy Coverage',
    format: 'percent',
    category: 'environment',
    unavailable: true,
    notes: 'Not available in ACS. USDA Forest Service Urban Tree Canopy datasets or USGS NLCD land cover are canonical sources.',
    externalSource: 'https://www.fs.usda.gov/research/products/dataandtools/datasets',
  },
  park_access: {
    key: 'park_access',
    code: '',
    label: 'Park Access (% within 10-min walk)',
    format: 'percent',
    category: 'environment',
    unavailable: true,
    notes: 'Not available in ACS. Trust for Public Land ParkScore or OSM-derived analyses are canonical sources.',
    externalSource: 'https://www.tpl.org/parkscore',
  },
}

// Default ACS detailed-table variables to all standard ADM levels when the
// entry doesn't override. Stub entries (unavailable: true) keep their empty
// default so they're never offered as a level-compatible metric.
for (const v of Object.values(CENSUS_VARIABLES)) {
  if (v.availableAtLevels) continue
  v.availableAtLevels = v.unavailable ? [] : [...ALL_ACS_LEVELS]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve a string to a VariableMeta. Accepts either a catalog key
 * (e.g. `'median_household_income'`) or a raw ACS code (e.g. `'B19013_001E'`).
 * Raw codes that don't exist in the catalog return a minimal stub.
 */
export function resolveVariable(input: string): VariableMeta {
  const fromCatalog = CENSUS_VARIABLES[input]
  if (fromCatalog) return fromCatalog

  // Lookup by code
  const byCode = Object.values(CENSUS_VARIABLES).find((v) => v.code === input)
  if (byCode) return byCode

  // Unknown raw ACS code — build a minimal stub so it can still be fetched
  if (/^B\d+_\d+E$/.test(input)) {
    return {
      key: input.toLowerCase(),
      code: input,
      label: input,
      format: 'number',
      category: 'community',
      notes: 'Raw ACS code — not in curated catalog.',
    }
  }

  throw new Error(
    `[LocalVision] Unknown variable: "${input}". Must be a catalog key or a raw ACS code like 'B19013_001E'.`,
  )
}

/**
 * True when `v` has data at geographic `level`. If the variable's
 * `availableAtLevels` is unset, treats it as universally available.
 */
export function isVariableAvailableAtLevel(v: VariableMeta, level?: string): boolean {
  if (!level) return true
  if (!v.availableAtLevels) return true
  return v.availableAtLevels.includes(level)
}

/** Return all catalog entries for a given category. */
export function variablesByCategory(category: VariableCategory): VariableMeta[] {
  return Object.values(CENSUS_VARIABLES).filter((v) => v.category === category)
}

/** Return all categories present in the catalog. */
export const CATEGORIES: VariableCategory[] = [
  'community',
  'housing',
  'economy',
  'education',
  'transportation',
  'health',
  'safety',
  'environment',
]
