"""Minimal LocalVision widget example.

Renders a 4-county Minnesota dashboard from hand-built data. Drop into
a Jupyter cell with `from example import widget; widget` (or copy the
code and run it inline).
"""

import pandas as pd

import localvision_py as lv

# 1) Four MN counties as a hand-built GeoJSON FeatureCollection.
#    In a real notebook you'd use loader.counties("27") from the JS lib,
#    fetch from www2.census.gov, or load a local .geojson file.
boundaries = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"GEOID": "27053", "NAME": "Hennepin"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [-93.6, 44.7], [-93.6, 45.2], [-93.1, 45.2],
                    [-93.1, 44.7], [-93.6, 44.7],
                ]],
            },
        },
        {
            "type": "Feature",
            "properties": {"GEOID": "27123", "NAME": "Ramsey"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [-93.2, 44.9], [-93.2, 45.1], [-93.0, 45.1],
                    [-93.0, 44.9], [-93.2, 44.9],
                ]],
            },
        },
        {
            "type": "Feature",
            "properties": {"GEOID": "27037", "NAME": "Dakota"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [-93.4, 44.6], [-93.4, 44.9], [-92.9, 44.9],
                    [-92.9, 44.6], [-93.4, 44.6],
                ]],
            },
        },
        {
            "type": "Feature",
            "properties": {"GEOID": "27003", "NAME": "Anoka"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [-93.5, 45.1], [-93.5, 45.4], [-93.1, 45.4],
                    [-93.1, 45.1], [-93.5, 45.1],
                ]],
            },
        },
    ],
}

# 2) A DataFrame with the values to bind. One row per county.
df = pd.DataFrame({
    "GEOID":      ["27053", "27123", "27037", "27003"],
    "NAME":       ["Hennepin", "Ramsey", "Dakota", "Anoka"],
    "median_income": [78000,    63000,    87000,    81000],
    "population":    [1281000,   552000,   429000,   356000],
    "rent":          [1340,      1180,     1410,     1290],
})

# 3) Variable metadata. Names + formats drive the UI.
variables = [
    {"key": "median_income", "label": "Median Income",     "format": "currency"},
    {"key": "population",    "label": "Total Population",  "format": "number"},
    {"key": "rent",          "label": "Median Gross Rent", "format": "currency"},
]

# 4) Build the widget. Drop it as the last expression in a Jupyter cell.
widget = lv.LocalVisionWidget.from_pandas(
    df,
    boundaries=boundaries,
    geoid_column="GEOID",
    variables=variables,
    active_kpi="median_income",
    height="500px",
)

if __name__ == "__main__":
    print("LocalVisionWidget configured for 4 MN counties.")
    print("Open this file in a Jupyter notebook, then evaluate `widget`.")
