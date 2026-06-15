import type { DashboardTemplate } from './types'

/**
 * Built-in dashboard templates. Each maps a domain ("equity", "housing",
 * "economic") to a curated set of ACS variables + display defaults.
 *
 * Variables reference catalog keys from `src/data/variables.ts`. Users
 * can override / extend any template at construction time via
 * `fromTemplate(name, { override: {...} })`.
 */
export const DASHBOARD_TEMPLATES: Record<string, DashboardTemplate> = {
  equity: {
    id: 'equity',
    label: 'Equity Dashboard',
    description:
      'Income, housing affordability, poverty, and educational attainment. Highlights disparities across neighborhoods.',
    variables: [
      'median_household_income',
      'per_capita_income',
      'poverty_count',
      'median_gross_rent',
      'bachelors_degree_count',
    ],
    activeKpi: 'median_household_income',
    colorScheme: 'redblue', // diverging — works well for ratio metrics
    defaultOuterBoundary: 'county',
    defaultInnerBoundary: 'tract',
  },

  housing: {
    id: 'housing',
    label: 'Housing Market',
    description:
      'Median home values, gross rents, total housing stock. Useful for housing affordability + supply analysis.',
    variables: [
      'median_home_value',
      'median_gross_rent',
      'total_housing_units',
      'median_household_income',
      'per_capita_income',
    ],
    activeKpi: 'median_home_value',
    colorScheme: 'viridis',
    defaultOuterBoundary: 'place',
    defaultInnerBoundary: 'tract',
  },

  economic: {
    id: 'economic',
    label: 'Economic Indicators',
    description:
      'Income, employment, commute patterns. Reads the regional economy at a glance.',
    variables: [
      'median_household_income',
      'per_capita_income',
      'workers_drove_alone',
      'aggregate_travel_time_to_work',
      'total_population',
    ],
    activeKpi: 'median_household_income',
    colorScheme: 'default',
    defaultOuterBoundary: 'county',
    defaultInnerBoundary: 'tract',
  },

  community: {
    id: 'community',
    label: 'Community Profile',
    description:
      'Population, age, housing units. The "what does my city look like" overview.',
    variables: [
      'total_population',
      'median_age',
      'total_housing_units',
      'median_household_income',
    ],
    activeKpi: 'total_population',
    colorScheme: 'cbSafeSequential',
    defaultOuterBoundary: 'county',
    defaultInnerBoundary: 'tract',
  },
}

export const TEMPLATE_IDS = Object.keys(DASHBOARD_TEMPLATES)

/**
 * Look up a template by id. Throws with a clear message + the list of
 * valid ids when the lookup fails — avoids the silent "undefined" trap.
 */
export function getTemplate(id: string): DashboardTemplate {
  const template = DASHBOARD_TEMPLATES[id]
  if (!template) {
    throw new Error(
      `[LocalVision] Unknown template "${id}". Available: ${TEMPLATE_IDS.join(', ')}`,
    )
  }
  return template
}
