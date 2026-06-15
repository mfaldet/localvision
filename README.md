# LocalVision

> Beautiful, interactive community-data dashboards — built around US Census boundaries with linked maps + charts.

LocalVision is a TypeScript library for building dashboards that combine a Census-aware choropleth map with linked, brush-able KPI charts. Designed for two complementary missions:

1. **Inner-city dynamics** — see how a single community varies internally (tracts, block groups, neighborhoods)
2. **Outer-city comparison** — see how your city compares to peer cities (counties, places, subdivisions)

[![CI](https://github.com/mfaldet/localvision/actions/workflows/ci.yml/badge.svg)](https://github.com/mfaldet/localvision/actions/workflows/ci.yml)

## Quick start

```bash
npm install localvision
```

```ts
import { LocalVisionApp, BoundaryLoader, CensusACS, bindDataToBoundaries } from 'localvision'

const loader = new BoundaryLoader({ persistentCache: true })
const acs    = new CensusACS({ apiKey: import.meta.env.VITE_CENSUS_API_KEY, sessionCache: true })

const [boundaries, table] = await Promise.all([
  loader.counties('27'),
  acs.fetchTemporal({
    variables: ['median_household_income', 'total_population', 'median_gross_rent'],
    geography: { state: '27', level: 'county' },
    years: [2018, 2019, 2020, 2021, 2022],
  }),
])

const binding = bindDataToBoundaries(boundaries, table)

new LocalVisionApp({
  container: '#app',
  boundaryContext: { stateFips: '27' },
  outer: { binding, activeKpi: 'median_household_income' },
  inner: { /* … */ },
  drillProvider: async ({ level, parent, context }) => { /* … */ },
})
```

Open `examples/acs-binding.html` for the canonical demo with city search, time slider, drill-down, and styling controls.

## Features

| Capability | Status |
|---|---|
| US Census boundaries (state → block group) | ✅ |
| ACS 5-year data binding (county / tract / place / etc.) | ✅ |
| Linked map + KPI charts (cross-filtering) | ✅ |
| Hierarchical drill-down with breadcrumbs | ✅ |
| Time slider + animated choropleth | ✅ |
| City-first navigation (US place autocomplete) | ✅ |
| Side-by-side comparison mode | ✅ |
| Custom map layers (OSM presets: parks, schools, transit, hospitals) | ✅ |
| PNG export + shareable URL hash state | ✅ |
| Display-settings panel (color scheme, opacity, line style, clip area) | ✅ |
| Light + dark + color-blind-safe themes | ✅ |
| Python / Jupyter wrapper (anywidget) | ✅ |
| Curated dashboard templates (equity, housing, economic, community) | ✅ |
| Vitest unit tests + GitHub Actions CI | ✅ |

## Documentation

- **[ROADMAP.md](ROADMAP.md)** — feature bundles + delivery progress
- **[docs/getting-started.md](docs/getting-started.md)** — install + first dashboard
- **[docs/data-binding.md](docs/data-binding.md)** — bringing your own data
- **[docs/boundaries.md](docs/boundaries.md)** — the BoundaryLoader + caching
- **[docs/styling.md](docs/styling.md)** — themes, color schemes, line patterns
- **[docs/python.md](docs/python.md)** — Jupyter widget usage
- **[python/](python/)** — Python wrapper subpackage

## Repository layout

```
src/
├── data/           Data binding, ACS client, label cleaners
├── geo/            Census boundary loader (TIGERweb + static files), FIPS, spatial helpers
├── layers/         Custom map layer manager (Overpass / OSM presets)
├── state/          Stores (selection, drilldown, time)
├── theme/          Tokens (dark + light + CB-safe), CSS variables
├── views/          OuterCityView, InnerCityView, LocalVisionApp
├── templates/      Curated dashboard configs (equity, housing, etc.)
├── export/         PNG export + URL state encoding
└── index.ts        Public API
python/             Python wrapper (anywidget + pandas helpers)
examples/           Working HTML demos
docs/               Documentation (this README + guides)
```

## Development

```bash
# Install
npm install

# Run the dev server (serves examples/acs-binding.html)
npm run dev

# Type-check
npm run typecheck

# Run unit tests
npm test

# Build the library (dist/)
npm run build
```

The Python wrapper has its own setup — see [python/README.md](python/README.md).

## License

MIT — see [LICENSE](LICENSE).
