# LocalVision

Interactive community-data dashboards on US Census boundaries: a choropleth map linked to brushable KPI charts, from state down to block group.

**Docs:** https://mfaldet.github.io/localvision/ · **Python/Jupyter wrapper:** [`python/`](python/)

Two views, one library. **Inner city** — how a single community varies inside itself (tracts, block groups, neighborhoods). **Outer city** — how a city compares to its peers (counties, places, subdivisions). Both bind ACS five-year data directly, drill down with breadcrumbs, animate over time, and export to PNG or a shareable URL.

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

`examples/acs-binding.html` is the full demo — city search, time slider, drill-down, styling controls. Run it locally with `npm run dev`.

## What's in it

| Capability | |
|---|---|
| US Census boundaries, state → block group (TIGERweb, cached) | ✅ |
| ACS 5-year data binding — county, tract, place, and more | ✅ |
| Linked map + KPI charts with cross-filtering | ✅ |
| Hierarchical drill-down with breadcrumbs | ✅ |
| Time slider and animated choropleth | ✅ |
| City-first navigation (US place autocomplete) | ✅ |
| Side-by-side comparison mode | ✅ |
| Custom map layers — OSM presets for parks, schools, transit, hospitals | ✅ |
| PNG export and shareable URL state | ✅ |
| Display settings — color scheme, opacity, line style, clip area | ✅ |
| Light, dark and color-blind-safe themes | ✅ |
| Python / Jupyter wrapper (anywidget) | ✅ |
| Dashboard templates — equity, housing, economic, community | ✅ |
| Vitest unit tests, GitHub Actions CI | ✅ |

## Docs

- [Getting started](docs/getting-started.md) — install and a first dashboard
- [Data binding](docs/data-binding.md) — bringing your own data
- [Boundaries](docs/boundaries.md) — the BoundaryLoader and caching
- [Styling](docs/styling.md) — themes, color schemes, line patterns
- [Python](docs/python.md) — Jupyter widget usage
- [Roadmap](ROADMAP.md)

## Layout

```
src/
├── data/        Data binding, ACS client, label cleaners
├── geo/         Census boundary loader (TIGERweb + static files), FIPS, spatial helpers
├── layers/      Custom map layer manager (Overpass / OSM presets)
├── state/       Stores (selection, drilldown, time)
├── theme/       Tokens (dark + light + CB-safe), CSS variables
├── views/       OuterCityView, InnerCityView, LocalVisionApp
├── templates/   Curated dashboard configs (equity, housing, etc.)
├── export/      PNG export + URL state encoding
└── index.ts     Public API
python/          Python wrapper (anywidget + pandas helpers)
examples/        Working HTML demos
docs/            Documentation site (VitePress)
```

## Development

```bash
npm install
npm run dev        # serves examples/acs-binding.html
npm run typecheck
npm test
npm run build      # library → dist/
```

The Python wrapper has its own setup — see [`python/README.md`](python/README.md).

## License

MIT — see [LICENSE](LICENSE).
