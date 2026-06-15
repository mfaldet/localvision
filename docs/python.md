# Python / Jupyter

LocalVision ships a Python wrapper as a sibling package — see [`python/`](../python/) for the source.

## Quick start

```bash
# In the repo root:
cd python
pip install -e .
npm install && npm run build   # one-time build of the widget JS bundle
```

```python
import pandas as pd
import json
import localvision_py as lv

# Your data
df = pd.read_csv("mn_counties.csv")  # GEOID + value columns
with open("mn_counties.geojson") as f:
    boundaries = json.load(f)

# Build the widget
widget = lv.LocalVisionWidget.from_pandas(
    df,
    boundaries=boundaries,
    geoid_column="GEOID",
    variables=[
        {"key": "median_income", "label": "Median Income",     "format": "currency"},
        {"key": "population",    "label": "Total Population",  "format": "number"},
    ],
    active_kpi="median_income",
)

widget  # last line of a Jupyter cell → interactive dashboard
```

## Time-aware data

If your DataFrame has one row per (geography, year):

```python
widget = lv.LocalVisionWidget.from_pandas(
    df,
    boundaries=boundaries,
    geoid_column="GEOID",
    variables=variables,
    time_axis={"times": [2018, 2019, 2020, 2021, 2022], "label": "Year"},
    active_kpi="median_income",
)
```

The widget time slider activates; play it to animate the choropleth.

## See also

Full Python docs, install notes, and limitations: [`python/README.md`](../python/README.md).
