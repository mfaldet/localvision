# LocalVision

Interactive community-data dashboards on US Census boundaries: a choropleth map linked to KPI charts, from county down to block group.

**Docs:** https://mfaldet.github.io/localvision/docs/ · **Python/Jupyter wrapper:** [`python/`](python/)

Two views, one library. **Inner city** — how a single community varies inside itself (tracts, block groups, neighborhoods). **Outer city** — how a city compares to its peers (counties, places, subdivisions). Both bind ACS five-year data (with your own Census API key), drill down with breadcrumbs, animate over time, and keep their state in a shareable URL. Not everything planned is built: see [What works today](#what-works-today).

## Quick start

LocalVision is not published to npm. Get the code from GitHub:

```bash
git clone https://github.com/mfaldet/localvision.git
cd localvision
npm install
npm run dev        # serves the full demo, examples/acs-binding.html
```

To use it in a project of your own, build it once and install it from the folder you cloned:

```bash
npm run build                    # in the localvision folder: library → dist/
npm install ../localvision       # in your project: adjust the path to where you cloned it
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

`examples/acs-binding.html` is the full demo — city search, time slider, drill-down, styling controls. `npm run dev` serves it.

## What works today

This is an early project built by one person. The lists below come from running each feature in a browser in November 2026, not from the plan.

**Works**

- US Census boundaries loaded from TIGERweb and cached: counties, places, county subdivisions, tracts and block groups
- City search across US places
- Map and KPI panel linked one way: click an area on the map to see its figures; switch the measure to recolor the map
- Drill-down from a county into its tracts, with breadcrumbs back
- Time slider and animated playback
- Display settings: color scheme (including color-blind-safe palettes), opacity, boundary color, pattern and width, and a clip area
- Markers, drawn regions and lines, bookmarks and a bookmark tour, kept between visits
- Light and dark themes
- Dashboard templates: equity, housing, economic, community
- 74 unit tests, run with a type check on every pull request

**Works, with known faults**

- ACS 5-year data binding needs your own Census API key. The Census API refuses requests without one, so the examples show no data until you add a key.
- City search can fail on first load and say "City search unavailable"; reloading the page fixes it. Matches are not ranked by size, so "Minneapolis" lists the one in Kansas first.
- PNG export fails in Chrome and downloads nothing. In comparison mode it saves only one of the two maps.
- Side-by-side comparison opens two maps. There is no swipe or difference view.
- Shareable links restore the city, level and year, but do not update when you switch between the inner and outer views.
- OpenStreetMap layers (parks, schools, transit stops, hospitals) depend on the public Overpass servers and were not confirmed working in the last check.
- The Python / Jupyter wrapper installs and builds, but is not on PyPI and has not been checked inside a notebook.
- The layout does not fit a phone screen yet.
- Keyboard navigation works, but charts have no screen-reader labels.

**Planned, not built**

- Clicking or brushing a chart to filter the map
- SVG and PDF export
- A grid-of-years view and year-over-year change
- A public call for adding your own map layers, and layer reordering
- A generated API reference and a gallery of examples
- Browser end-to-end tests and release automation

LocalVision is not published to npm or PyPI. See the [roadmap](ROADMAP.md) for the status of each planned piece.

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
