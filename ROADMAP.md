# LocalVision Roadmap

A prioritized plan for getting LocalVision from "promising skeleton" to "full-sized library." Each entry describes a **feature bundle** — a cohesive set of features that, shipped together, unlocks a new capability for users.

## Status

**12 of 15 bundles shipped** (Wave 1, Wave 2, most of Waves 3 & 4):

- ✅ Wave 1: Data Foundation · Cross-filtering · Drill-down · Time Dimension
- ✅ Wave 2: Custom Layers · Comparison Mode · Python Bridge · Export & Sharing
- ✅ Wave 3 (partial): Theming · Accessibility · _Annotation + Performance deferred_
- ✅ Wave 4 (partial): Quality & Release · Templates · _Full docs site deferred_

Mark legend: ✅ shipped, 🚧 in progress, blank = not started.

## Current state

What's in place (or in flight):

- `InnerCityView` — single-community split layout, map + linked KPI chart panel
- `OuterCityView` — multi-community choropleth + comparison panel
- `LocalVisionApp` — unified wrapper with view toggle + boundary dropdown
- `BoundaryLoader` — US Census TIGERweb integration for all ADM levels and sub-community boundary types
- Chart engine — bar, line, area, scatter, donut via Observable Plot
- Theme system — CSS custom properties, dark-first

What's missing to be a real library: real-data binding, linked interactions, time, drill-down, custom layers, comparison mode, Python bridge, export/share, annotation, polish, docs, tests, release tooling, templates.

## The four waves

The 15 bundles below are organized into four delivery waves. Each wave is a coherent milestone — at the end of each, the library is meaningfully more capable than at the start, and you should pause to validate before moving on.

| Wave | Goal | Bundles |
|---|---|---|
| 1. Make it useful | Deliver on the core mission of community data visualization | 1–4 |
| 2. Extend the reach | Broaden audience and use cases | 5–8 |
| 3. Polish & adoption | Production-grade quality | 9–12 |
| 4. Ship | Public release | 13–15 |

Effort scale: **S** = ~1 day · **M** = 2–3 days · **L** = 3–7 days · **XL** = 1–2 weeks

---

## Wave 1 — Make it useful

These four bundles together transform the library from "pretty shell" into something a researcher could actually use to study a community.

### 1. Data Foundation [L]  ✅

**Capability:** Bind real tabular data (CSV/Pandas/Census ACS) to Census geographies. Stop hand-writing community objects.

**Scope:**
- CSV/JSON import for KPI data
- Bind tables to boundaries via `GEOID` property (the universal Census key)
- New `DataBinding` model that pairs a `BoundaryLoader` result with a table
- Census ACS API integration for canonical demographic variables
- Deprecate the hand-built `CommunityRecord[]` model (keep as escape hatch)

**Key deliverables:** `src/data/csv.ts`, `src/data/binding.ts`, `src/data/acs.ts`; new `DataAdapter` interface; example: load MN counties + ACS median income → choropleth in 10 lines.

**Before:** Gather 1–2 real datasets you want to use as primary test cases. Decide which ~6 ACS variables to bless as first-class (suggest: population, median household income, poverty rate, educational attainment, unemployment, race/ethnicity breakdown). Get a free Census API key.

**After:** Try binding the datasets you gathered, report friction. Decide if any of the test datasets reveal a missing data type.

### 2. Cross-filtering / Interlinking [M]  ✅

**Capability:** The "linked KPIs" promise. Click in a chart → highlight on the map. Brush on the map → filter the charts.

**Scope:**
- Central selection store shared across map and charts
- Chart click → map highlight (and vice versa, already partial)
- Plot brushing → map filter
- Map polygon-select tool → chart filter
- Clear/reset control

**Key deliverables:** `src/state/selection.ts`; `Plot.brush()` integration in the chart renderer; updated demos showing live cross-filtering.

**Before:** Sketch the 4–5 cross-filter interactions that matter most to you. Decide: when multiple charts have brushes active, do they AND together or replace each other?

**After:** Pressure-test with real data. Identify any slow-feeling interactions for performance bundle later.

### 3. Hierarchical Drill-down [M]  ✅

**Capability:** Click a county → zoom in + load its tracts. Click a tract → zoom in + load its block groups. Breadcrumb to navigate back.

**Scope:**
- Drill stack with breadcrumb UI
- Click handler that fits camera to feature and advances boundary level
- Optional auto-drill on zoom-in past threshold
- Smooth transitions (camera + data swap)

**Key deliverables:** `src/state/drilldown.ts`; breadcrumb component; demo: MN → Hennepin County → tracts.

**Before:** Decide canonical drill paths (suggest: outer = state → county → place; inner = county → tract → block group). Decide UX: click-the-feature, or explicit drill button?

**After:** Validate drill paths feel natural. Identify hierarchies that break (e.g., Virginia's independent cities).

### 4. Time Dimension [M]  ✅

**Capability:** Animated playback of community metrics over time. Time slider, year-over-year deltas, small-multiples.

**Scope:**
- Time-aware KPI data model (`{ time, value }` data points)
- TimeSlider component in header
- Animated choropleth playback
- Small-multiple "grid of years" view
- Year delta highlight

**Key deliverables:** `src/state/time.ts`; TimeSlider component; demo: MN counties median income, 2010–2023, playing.

**Before:** Identify which KPIs need temporal support first. Decide cadence (yearly? decennial?), default range, missing-data behavior.

**After:** Test animation performance with state-scale data. Decide on default play speed / loop.

**End of Wave 1 — validation checkpoint:** Build one real dashboard with your own data + cross-filtering + drill-down + time. If anything feels wrong, that's the signal to refine Wave 1 before pressing on.

---

## Wave 2 — Extend the reach

These bundles broaden the library's audience and use cases beyond a single-purpose dashboard.

### 5. Custom Layers System [M]  ✅

**Capability:** Add POI / transit / park / road / user-GeoJSON layers on top of community data.

**Scope:**
- Public API: `app.addLayer({ id, source, paint, layout })`
- Layer panel UI (toggle visibility, opacity slider, reorder)
- Preset library: schools, hospitals, transit stops, parks (sourced from OSM via Overpass)
- Per-layer click handlers

**Key deliverables:** `src/layers/manager.ts`, `src/layers/presets/*`, layer panel UI, demo with multiple toggled layers.

**Before:** Decide which preset layers ship in v1 (suggest: schools, transit stops, parks). Decide how Overpass queries should be cached.

**After:** Test with custom POI data. Resolve any tooltip-vs-tooltip interaction conflicts.

### 6. Comparison Mode [L]  ✅

**Capability:** Side-by-side maps. Compare 2 KPIs, or 2 years, or 2 areas — with synchronized pan/zoom.

**Scope:**
- New `ComparisonView` class (or a `comparison: true` mode on `OuterCityView`)
- Sync pan/zoom between two MapLibre instances via `move` events
- Optional third "delta" map for difference visualization
- "Swipe" mode (slider revealing one over the other)

**Key deliverables:** `src/views/ComparisonView.ts`; sync logic; demo: 2010 vs 2020 income choropleth.

**Before:** Decide which comparison patterns matter most (2 KPIs same year? Same KPI two years? Two regions?). Decide if delta computation is built-in or BYO.

**After:** Test cognitive load — is side-by-side too much? Decide if comparison should be its own view or a mode.

### 7. Python Bridge (anywidget) [L]  ✅

**Capability:** Use LocalVision from Jupyter / Python with pandas DataFrames.

**Scope:**
- Python package `localvision-py` (or whatever name we land on)
- anywidget-based wrapper around the JS library
- pandas DataFrame → boundary binding helper
- Documentation: "From pandas to a localvision dashboard in 10 lines"
- Publish to PyPI

**Key deliverables:** `python/` subfolder (or sibling repo); `localvision_py/widget.py`; pandas utilities; example notebooks.

**Before:** Decide PyPI package name. Choose Python version floor (suggest: 3.10+). Decide if conda-forge is in scope.

**After:** Stress-test with a real notebook workflow. Identify any Python-side helpers that are missing.

### 8. Export & Sharing [M]  ✅

**Capability:** Export the current dashboard as PNG / SVG / PDF. Encode app state in shareable URLs.

**Scope:**
- "Export" button in header
- PNG via canvas
- SVG export for vector use
- PDF report mode (multi-page layout: cover + map + charts + footer)
- URL state encoding (view + boundary + selection + time + camera)

**Key deliverables:** `src/export/{png,svg,pdf}.ts`; `src/state/url.ts`; export UI.

**Before:** Decide if PDF should be a "report" template (title + legend + footer) or just a screenshot. Decide what goes in the shareable URL.

**After:** Test export quality at various sizes. Decide if export should bundle the underlying data (CSV download).

**End of Wave 2 — validation checkpoint:** Publish a tutorial-style example using all of Wave 1 + Wave 2 features. Use it to surface gaps in the API surface.

---

## Wave 3 — Polish & adoption

Production-grade quality. By the end of Wave 3, the library should feel good to use in real work.

### 9. Annotation / Storytelling [L]

**Capability:** Draw rectangles, polygons, lines, labels on the map. Save annotated views as bookmarks. Tour mode.

**Scope:**
- Drawing tools (rectangle, polygon, line, freehand)
- Text labels with leader lines
- Bookmark current view (geometry + selection + camera)
- Tour: linked bookmarks with optional narration

**Before:** Decide if annotations persist across reloads (localStorage? exportable JSON?). Decide tour UX (slide-style? auto-advance?).

**After:** Test storytelling workflows end-to-end. Identify annotation-vs-data conflicts.

### 10. Theming & Customization [S]  ✅

**Capability:** Multiple themes (light + dark + brand). Color-blind palettes. Customization API.

**Scope:**
- Light mode theme
- Brand theme presets (academic, journalism, civic)
- Color-blind safe palette options
- Theme builder / customization API

**Before:** Define brand themes you care about, or leave brand-blank. Decide if light mode needs a different default map style.

**After:** Validate readability across themes. Decide if runtime theme switching is part of the public API.

### 11. Performance & Scale [L]

**Capability:** Handle nation-wide data without lag.

**Scope:**
- Vector tile source for boundaries (replace GeoJSON for large levels)
- Web worker for cross-filter aggregation
- Virtualized chart panel (many charts)
- Lazy loading of off-screen panels

**Before:** Decide if a hosted tile service is in scope or BYO. Define performance SLAs (e.g., "60fps panning with 9k tract overlays").

**After:** Measure against baseline. Document tradeoffs (bundle size, memory).

### 12. Accessibility [M]  ✅

**Capability:** Keyboard navigation, screen reader labels, WCAG AA contrast.

**Scope:**
- Tab-navigable controls
- ARIA labels for charts and maps
- Map keyboard pan/zoom
- Color contrast audit + fixes

**Before:** Decide WCAG target (AA recommended). Identify any consultants to involve.

**After:** Test with VoiceOver / NVDA. Document a11y status per component.

**End of Wave 3 — validation checkpoint:** Pick a benchmark dashboard. Run perf, a11y, and visual reviews. Address any blocker before Wave 4.

---

## Wave 4 — Ship

Public release.

### 13. Developer Experience & Docs [L]  🚧 (README + guides shipped; full docs site deferred)

**Capability:** Full docs site with API reference, guides, gallery.

**Scope:**
- Docs site (Astro Starlight or VitePress)
- Auto-generated API reference (TypeDoc)
- Guides: getting started, theming, data binding, Python integration
- Gallery of working examples

**Before:** Pick docs framework. Decide hosting (gh-pages, Vercel, Netlify).

**After:** Get feedback from first external user. Iterate on guide ordering.

### 14. Quality & Release [M]  ✅

**Capability:** First public npm release with CI, tests, semver.

**Scope:**
- Vitest unit tests (geo loader, fips, theme resolution, state stores)
- Playwright E2E for key user flows
- GitHub Actions CI
- semantic-release or changesets
- npm publish workflow

**Before:** Decide on versioning policy (strict semver?). Decide on changelogging tool.

**After:** Monitor first downloads. Triage early GitHub issues.

### 15. Real-world Templates [M]  ✅

**Capability:** Opinionated dashboards out of the box.

**Scope:**
- "Equity Dashboard" template (income, housing, race)
- "Economic Indicators" template (employment, GDP, wages)
- "Housing Market" template (median price, vacancy, time-on-market)
- "Public Health" template (life expectancy, food access, hospital access)
- One-line `LocalVisionApp.fromTemplate('equity', { stateFips: '27' })`

**Before:** Pick the 3–5 templates for v1. Source canonical data sources for each.

**After:** Open template authoring to community. Measure adoption.

---

## What to do now (before Bundle 1)

To start Bundle 1 productively, please:

1. **Pick a flagship dataset.** Choose 1–2 real datasets (CSV with FIPS-keyed rows) that represent the kind of analysis LocalVision should serve. These become the test cases and the basis for the first real example.
2. **Get a Census API key.** Free and instant: https://api.census.gov/data/key_signup.html. Stash it somewhere you can paste back later.
3. **Decide the v1 ACS variable set.** Suggested defaults: population, median household income, poverty rate, educational attainment, unemployment rate, race/ethnicity breakdown. Tell me if you'd swap any out.
4. **Sketch the v1 cross-filter interactions** (for Bundle 2 prep — useful to think about while we build Bundle 1, since data shape influences interaction shape).

## After each bundle

A short ritual after every bundle:
1. Build a small example that exercises the new capability.
2. Note 1–2 friction points and decide if they're addressed now, deferred to a later bundle, or noted as known limitations.
3. Tag a release (`v0.X.0`) so we have a clean reference point.
4. Update this roadmap if the next bundle's priority has shifted based on what you learned.

## Open strategic questions

- **Scope:** US-only forever, or eventually international? (Current Census-centric design assumes US.)
- **Audience:** Solo researcher / journalist / planner, or larger product teams? (Influences DX investment.)
- **Monetization:** Pure OSS, or freemium with hosted services (tile hosting, data fetching)?

These don't need answers today, but they'll come up by Wave 3.
