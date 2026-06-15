"""LocalVision — interactive community-data dashboards in Jupyter.

Quick start:

    >>> import pandas as pd
    >>> import json
    >>> import localvision_py as lv
    >>> df = pd.read_csv("acs_counties.csv")  # GEOID + value columns
    >>> with open("mn_counties.geojson") as f:
    ...     boundaries = json.load(f)
    >>> widget = lv.LocalVisionWidget.from_pandas(
    ...     df,
    ...     boundaries=boundaries,
    ...     geoid_column="GEOID",
    ...     variables=[
    ...         {"key": "median_income", "label": "Median Household Income", "format": "currency"},
    ...         {"key": "population",    "label": "Total Population",        "format": "number"},
    ...     ],
    ...     active_kpi="median_income",
    ... )
    >>> widget  # displays the interactive dashboard

See https://github.com/mfaldet/localvision for the full library.
"""

from .widget import LocalVisionWidget
from .data import dataframe_to_binding

__version__ = "0.1.0"
__all__ = ["LocalVisionWidget", "dataframe_to_binding", "__version__"]
