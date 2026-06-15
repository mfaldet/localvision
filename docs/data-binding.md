# Data binding

The library's core data type is a `DataBinding`: boundaries + a metric table joined by GEOID. This guide covers three ways to build one.

## 1. Census ACS (built-in)

```ts
import { CensusACS, BoundaryLoader, bindDataToBoundaries } from 'localvision'

const acs    = new CensusACS({ apiKey: '...' })
const loader = new BoundaryLoader({ persistentCache: true })

const [boundaries, table] = await Promise.all([
  loader.counties('MN'),
  acs.fetch({
    variables: ['median_household_income', 'total_population'],
    geography: { state: 'MN', level: 'county' },
  }),
])

const binding = bindDataToBoundaries(boundaries, table)
```

**Catalog**: ~12 curated ACS variables (see `CENSUS_VARIABLES`). Pass any ACS code (e.g. `"B19013_001E"`) and the client builds it on the fly.

**Temporal data**: use `acs.fetchTemporal({ years: [2018, 2019, ...] })` instead of `fetch()` — the resulting binding ships with a `timeAxis` and the dashboard's time slider activates.

## 2. CSV file

Got a CSV with a `GEOID` column?

```ts
import { loadCsv, bindDataToBoundaries, BoundaryLoader } from 'localvision'

const table = await loadCsv('/data/my_metrics.csv')
const boundaries = await new BoundaryLoader().counties('MN')
const binding = bindDataToBoundaries(boundaries, table)
```

For inline strings, use `parseCsv(csvText)`.

CSV columns are auto-detected:
- `GEOID` / `geoid` / `GEO_ID` → the geoid column
- `NAME` / `name` → display label
- Everything else → values, each becomes a variable

Override column mapping via `parseCsv(text, { geoidColumn, valueColumns, columnToVariable })`.

## 3. Custom data adapter

If your data is already in some other shape, build a `DataTable` by hand:

```ts
const table = {
  variables: [
    { key: 'income', label: 'Median Income', format: 'currency', category: 'economy' },
  ],
  rows: [
    { geoid: '27053', name: 'Hennepin', values: { income: 78000 } },
    { geoid: '27123', name: 'Ramsey',   values: { income: 63000 } },
    // ...
  ],
}

const binding = bindDataToBoundaries(boundaries, table)
```

## Time-varying data

Add a `time` field to each row + a `timeAxis` to the table:

```ts
const table = {
  variables: [...],
  rows: [
    { geoid: '27053', time: 2018, values: { income: 70000 } },
    { geoid: '27053', time: 2019, values: { income: 72000 } },
    { geoid: '27053', time: 2020, values: { income: 71000 } },
    // ...
  ],
  timeAxis: { times: [2018, 2019, 2020], label: 'Year' },
}
```

The dashboard's time slider activates automatically. Scrubbing updates the choropleth + the distribution histograms.

## Level-aware metric filtering

Each variable can declare which geographic levels it's available at:

```ts
{
  key: 'crime_rate',
  label: 'Violent Crime Rate',
  format: 'rate',
  category: 'safety',
  availableAtLevels: ['state', 'county'],  // skip places + tracts + bg
}
```

The KPI picker auto-hides metrics that aren't available at the user's current boundary level. Switch from County → Tract and crime-rate disappears from the pill row; switch back and it reappears.

ACS variables in the curated catalog default to all six ADM levels (state through block group).
