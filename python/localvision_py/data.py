"""pandas → DataBinding conversion.

Builds the JSON shape the JS LocalVisionApp expects for its `binding`
option. Output structure mirrors `src/data/types.ts` in the JS library:

    {
        "boundaries": GeoJsonFeatureCollection,
        "table": {
            "variables": [VariableMeta, ...],
            "rows": [DataRow, ...],
            "timeAxis": { "times": [...], "label": "Year" } | None,
        },
        "geoidProperty": "GEOID",  # or whatever was passed
    }
"""

from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List, Optional, Union


def dataframe_to_binding(
    df: Any,  # pandas.DataFrame
    boundaries: Dict[str, Any],
    geoid_column: str,
    variables: List[Dict[str, Any]],
    time_axis: Optional[Dict[str, Any]] = None,
    geoid_property: str = "GEOID",
) -> Dict[str, Any]:
    """Convert a DataFrame + boundary GeoJSON into a DataBinding dict.

    Parameters
    ----------
    df : pandas.DataFrame
        One row per (geography) or per (geography, time) pair.
    boundaries : dict
        GeoJSON FeatureCollection joined by GEOID against the dataframe.
    geoid_column : str
        Name of the GEOID column in `df`. Coerced to string so leading
        zeros in FIPS codes survive the trip through JSON.
    variables : list of dict
        Variable metadata. Each dict needs at least `key` and `label`.
        Optional: `format` (one of 'number', 'currency', 'percent',
        'rate'), `unit`, `category`, `availableAtLevels`.
    time_axis : dict, optional
        { "times": [...], "label": "Year" }. The DataFrame must include
        a column whose name matches the time field (default 'time').
    geoid_property : str
        Property on each feature that holds the GEOID. Default 'GEOID'.

    Returns
    -------
    dict
        Ready to pass into `LocalVisionWidget(binding=...)`.
    """
    if geoid_column not in df.columns:
        raise ValueError(
            f"DataFrame missing geoid column {geoid_column!r}; "
            f"available columns: {list(df.columns)}"
        )

    var_keys = [v["key"] for v in variables]
    missing = [k for k in var_keys if k not in df.columns]
    if missing:
        raise ValueError(
            f"DataFrame missing variable columns: {missing}. "
            f"Available columns: {list(df.columns)}"
        )

    # Normalise the GEOID column to string. Census FIPS codes commonly
    # come in as ints, which drops leading zeros (Alabama becomes 1 not '01').
    df = df.copy()
    df[geoid_column] = df[geoid_column].astype(str)

    rows: List[Dict[str, Any]] = []
    time_field = (time_axis or {}).get("field", "time")
    for record in df.to_dict(orient="records"):
        values: Dict[str, Union[float, int, None]] = {}
        for v_key in var_keys:
            raw = record.get(v_key)
            values[v_key] = _clean_numeric(raw)
        row: Dict[str, Any] = {
            "geoid": str(record[geoid_column]),
            "values": values,
        }
        # Preserve a name column for tooltips when present
        if "NAME" in record:
            row["name"] = str(record["NAME"])
        if time_axis is not None and time_field in record:
            row["time"] = record[time_field]
        rows.append(row)

    table: Dict[str, Any] = {
        "variables": variables,
        "rows": rows,
    }
    if time_axis is not None:
        table["timeAxis"] = {
            "times": list(time_axis["times"]),
            "label": time_axis.get("label", "Time"),
        }

    return {
        "boundaries": boundaries,
        "table": table,
        "geoidProperty": geoid_property,
    }


def _clean_numeric(raw: Any) -> Union[float, int, None]:
    """Coerce numeric-looking values; turn NaN / None into None for JSON."""
    if raw is None:
        return None
    try:
        f = float(raw)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    # Preserve integers as ints when possible (smaller JSON, friendlier UI)
    if f.is_integer() and abs(f) < 1e15:
        return int(f)
    return f
