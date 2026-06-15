---
layout: home

hero:
  name: LocalVision
  text: Community-data dashboards
  tagline: Interactive maps + linked KPI charts, built on US Census boundaries. See a city's internal dynamics, or compare it to its peers.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/mfaldet/localvision

features:
  - icon: 🗺️
    title: Census-aware boundaries
    details: Every ADM level from state to block group, plus places, tracts, ZCTAs, school + legislative districts — fetched from TIGERweb and cached locally.
  - icon: 🔗
    title: Linked map + charts
    details: Click a feature on the map to filter the charts; the choropleth, distribution histograms, and KPI cards all stay in sync.
  - icon: 🏙️
    title: City-first navigation
    details: Type any US incorporated place to drop into its dynamics. Drill from county to tract to block group with a breadcrumb to climb back.
  - icon: ⏱️
    title: Time dimension
    details: Bind multi-year ACS data and scrub a time slider — the choropleth and distributions animate across years.
  - icon: 🎨
    title: Deep styling controls
    details: Color schemes (incl. color-blind-safe), fill opacity, line patterns, light + dark themes, clip-to-region, and freehand annotation.
  - icon: 🐍
    title: Python & Jupyter
    details: A pandas-friendly anywidget wrapper — build a dashboard from a DataFrame in a notebook cell.
---

## Install

```bash
npm install localvision
```

## A dashboard in ten lines

```ts
import { LocalVisionApp, BoundaryLoader, CensusACS, bindDataToBoundaries } from 'localvision'

const loader = new BoundaryLoader({ persistentCache: true })
const acs    = new CensusACS({ apiKey: import.meta.env.VITE_CENSUS_API_KEY })

const [boundaries, table] = await Promise.all([
  loader.counties('MN'),
  acs.fetch({ variables: ['median_household_income'], geography: { state: 'MN', level: 'county' } }),
])

new LocalVisionApp({
  container: '#app',
  outer: { binding: bindDataToBoundaries(boundaries, table), activeKpi: 'median_household_income' },
  inner: { /* … */ },
})
```

Head to the [getting-started guide](/getting-started) for the full walkthrough including city search, drill-down, and templates.
