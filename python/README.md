# localvision — Python / Jupyter wrapper

Interactive community-data dashboards from pandas, rendered as Jupyter widgets via [anywidget](https://anywidget.dev/).

This is the Python wrapper around the [LocalVision JS library](../). It bundles the JS into a single widget file so you can `pip install localvision` and get an offline-capable widget.

## Install (from source, editable)

```bash
# From the repo root:
cd python

# 1. Install Python deps + the package in editable mode
pip install -e .

# 2. Build the widget JS bundle (one time)
npm install
npm run build
```

The build step produces `localvision_py/static/widget.js` (~1.5MB bundle of MapLibre + Plot + the LocalVision library). Re-run after pulling JS-side changes.

## Quick start

```python
import pandas as pd
import json
import localvision_py as lv

# 1. Load your data
df = pd.read_csv("mn_counties.csv")  # GEOID + value columns
with open("mn_counties.geojson") as f:
    boundaries = json.load(f)

# 2. Build the widget
widget = lv.LocalVisionWidget.from_pandas(
    df,
    boundaries=boundaries,
    geoid_column="GEOID",
    variables=[
        {"key": "median_income", "label": "Median Income",     "format": "currency"},
        {"key": "population",    "label": "Total Population",  "format": "number"},
        {"key": "rent",          "label": "Median Gross Rent", "format": "currency"},
    ],
    active_kpi="median_income",
)

widget  # last line of a Jupyter cell → renders the dashboard
```

That's it — pan, zoom, click features, switch KPIs, all live.

## Updating values from Python

The widget mirrors three synced traits:

```python
# Switch the active KPI
widget.set_active_kpi("rent")

# Push a new binding (e.g. swap years of ACS data)
widget.binding = json.dumps(new_binding_dict)
```

## Time-aware data

If your DataFrame has one row per (geography, year):

```python
widget = lv.LocalVisionWidget.from_pandas(
    df,  # rows include a 'time' column
    boundaries=boundaries,
    geoid_column="GEOID",
    variables=[...],
    time_axis={"times": [2018, 2019, 2020, 2021, 2022], "label": "Year"},
    active_kpi="median_income",
)
```

The widget shows a time slider; play it to animate the choropleth across years.

## Direct DataBinding (no DataFrame helper)

If your data is already in DataBinding shape (e.g. from a JS endpoint):

```python
widget = lv.LocalVisionWidget(
    binding={
        "boundaries": geojson_feature_collection,
        "table": {
            "variables": [...],
            "rows": [...],
        },
        "geoidProperty": "GEOID",
    },
    active_kpi="median_income",
)
```

## Project layout

```
python/
├── pyproject.toml              # Python package metadata
├── package.json                # Vite + TS for the JS bundle
├── vite.config.ts              # Build config: bundles widget-src/* → static/widget.js
├── widget-src/index.ts         # Source of the anywidget JS bundle
├── localvision_py/
│   ├── __init__.py             # Public Python API
│   ├── widget.py               # LocalVisionWidget anywidget subclass
│   ├── data.py                 # pandas → DataBinding conversion
│   └── static/
│       ├── widget.js           # Bundled JS (built by `npm run build`)
│       └── widget.css          # Widget host styles
└── README.md
```

## Known limitations (v0.1)

- **Selection events don't sync back to Python yet** — clicks on the map fire the JS `featureSelect` event but the widget doesn't forward to a Python trait. Easy follow-up.
- **No `drillProvider` from Python** — drill-down works inside the widget but is bounded to whatever's in your initial binding. Wire one up by passing a `drillProvider` URL or callback through `config` (TODO).
- **Bundle size** — ~1.5MB for the widget JS because we bundle MapLibre, Plot, and the LocalVision library. Fine for local notebooks; if you're publishing notebooks online, consider serving the bundle from a CDN.

## Publishing to PyPI

When the JS API + Python API feel stable:

```bash
pip install hatch
hatch build
hatch publish
```

The build pulls in the prebuilt `localvision_py/static/widget.js`, so make sure you've run `npm run build` first.
