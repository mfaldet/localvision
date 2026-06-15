# Getting started

This guide walks through your first LocalVision dashboard end-to-end.

## Prerequisites

- Node.js 18+
- A Census API key (free, instant): https://api.census.gov/data/key_signup.html
- A blank HTML page or a Vite project

## 1. Install

```bash
npm install localvision
```

## 2. Set the API key

Create `.env.local` in your project root:

```bash
VITE_CENSUS_API_KEY=your_key_here
```

(The library works without one for low-volume queries, but you'll hit Census's rate limiter without it.)

## 3. Wire up your first dashboard

```ts
import {
  LocalVisionApp,
  BoundaryLoader,
  CensusACS,
  bindDataToBoundaries,
} from 'localvision'

import 'localvision/styles' // injects the dashboard CSS

// 1) Load boundary geometries + ACS metric data in parallel
const loader = new BoundaryLoader({ persistentCache: true })
const acs = new CensusACS({
  apiKey: import.meta.env.VITE_CENSUS_API_KEY,
  sessionCache: true,
})

const [boundaries, table] = await Promise.all([
  loader.counties('MN'),
  acs.fetch({
    variables: [
      'median_household_income',
      'total_population',
      'median_gross_rent',
    ],
    geography: { state: 'MN', level: 'county' },
  }),
])

// 2) Join them by GEOID
const binding = bindDataToBoundaries(boundaries, table)

// 3) Mount the dashboard
new LocalVisionApp({
  container: '#app',
  boundaryContext: { stateFips: '27' },
  outer: {
    binding,
    activeKpi: 'median_household_income',
  },
  // Inner view is a placeholder when you don't have a drillProvider —
  // it gets replaced with real data as soon as the user picks a city.
  inner: {
    boundary: { type: 'FeatureCollection', features: [] },
    kpis: [{ id: 'placeholder', label: 'placeholder', format: 'number', data: [] }],
    charts: [{ type: 'bar', kpiId: 'placeholder' }],
  },
})
```

Hello, dashboard. ✨

## 4. Add drill-down + city search (city-first mode)

LocalVision has a richer "pick a city, see its dynamics" flow. Wire it up by adding a `drillProvider`:

```ts
new LocalVisionApp({
  container: '#app',
  boundaryContext: { stateFips: '27' },
  outer: { binding, activeKpi: 'median_household_income' },
  inner: { /* same placeholder as above */ },

  drillProvider: async ({ level, parent, context }) => {
    const stateFips = context.stateFips ?? '27'
    let boundaries
    switch (level) {
      case 'state':  boundaries = loader.states(); break
      case 'county': boundaries = loader.counties(stateFips); break
      case 'place':  boundaries = loader.places(stateFips); break
      case 'cousub': boundaries = loader.countySubdivisions(stateFips); break
      case 'tract':  boundaries = loader.tracts(stateFips, context.countyFips); break
      case 'bg':     boundaries = loader.blockGroups(stateFips, context.countyFips); break
      default: return null
    }

    const table = await acs.fetch({
      variables: ['median_household_income', 'total_population', 'median_gross_rent'],
      geography: { state: stateFips, level, county: context.countyFips },
    })

    return bindDataToBoundaries(await boundaries, table)
  },
})
```

Now:
- A city search appears at the top-left of the header
- Typing "Rosemount" finds it; clicking loads the tracts of its containing county
- Drill button in the detail panel zooms further into block groups
- Breadcrumb to navigate back

## 5. Bootstrap from a template (alternative)

If you have a specific domain in mind, skip the manual variable list:

```ts
import { LocalVisionApp } from 'localvision'

const app = LocalVisionApp.fromTemplate('equity', {
  container: '#app',
  boundaryContext: { stateFips: '27' },
  outer: { binding },
  inner: { /* placeholder */ },
  drillProvider: /* same as above */,
})
```

Templates ship with: `equity`, `housing`, `economic`, `community`. See [Templates](templates.md).

## Next steps

- **[Data binding](data-binding.md)** — bring your own CSV / DataFrame
- **[Boundaries](boundaries.md)** — caching, custom tile sources
- **[Styling](styling.md)** — themes, color schemes, line patterns
