"""anywidget-based wrapper for LocalVision.

Bridges Python data (pandas DataFrames, Census ACS, etc.) into the
LocalVision JS dashboard. The widget speaks to the JS side via three
synced traits: `binding` (the DataBinding JSON), `active_kpi`, and
`config` (display + behaviour options).

Lifecycle:
  1. Python constructs the widget with a binding + active_kpi
  2. anywidget renders the bundled JS into the Jupyter cell
  3. JS subscribes to trait changes; Python mutations flow to JS instantly
  4. Selection events flow back via Comm messages (TODO: implement
     selection sync in a follow-up)
"""

from __future__ import annotations

import json
import pathlib
from typing import Any, Dict, Iterable, List, Optional

import anywidget
import traitlets

# Path to the bundled JS file. Built by `npm run build:python` at the
# project root, which emits to `python/localvision_py/static/widget.js`.
_BUNDLE_PATH = pathlib.Path(__file__).parent / "static" / "widget.js"


class LocalVisionWidget(anywidget.AnyWidget):
    """Interactive community-data dashboard rendered as a Jupyter widget.

    Parameters
    ----------
    binding : str or dict
        Either a JSON string of a LocalVision DataBinding (boundaries +
        table), or the equivalent dict. The `dataframe_to_binding` helper
        in this package builds these from a pandas DataFrame.
    active_kpi : str
        Variable key driving the choropleth fill colour.
    config : dict, optional
        Extra options forwarded to LocalVisionApp: `defaultView`,
        `defaultInnerBoundary`, `defaultOuterBoundary`, `theme`, etc.
        See the JS library's LocalVisionAppOptions for the full list.
    width, height : str
        CSS sizes for the widget container. Default 100% wide,
        '600px' tall — adjust to taste.
    """

    _esm = _BUNDLE_PATH
    _css = pathlib.Path(__file__).parent / "static" / "widget.css"

    # ── Synced traits ────────────────────────────────────────────────────────
    binding = traitlets.Unicode("{}").tag(sync=True)
    active_kpi = traitlets.Unicode("").tag(sync=True)
    config = traitlets.Dict({}).tag(sync=True)
    width = traitlets.Unicode("100%").tag(sync=True)
    height = traitlets.Unicode("600px").tag(sync=True)

    # ── Constructors ────────────────────────────────────────────────────────

    def __init__(
        self,
        binding: Any,
        active_kpi: str,
        config: Optional[Dict[str, Any]] = None,
        width: str = "100%",
        height: str = "600px",
        **kwargs: Any,
    ) -> None:
        # Accept either a JSON string or a dict for `binding`. Normalise
        # to JSON string so the trait stays comparable across sync events.
        if not isinstance(binding, str):
            binding = json.dumps(binding)
        super().__init__(
            binding=binding,
            active_kpi=active_kpi,
            config=config or {},
            width=width,
            height=height,
            **kwargs,
        )

    @classmethod
    def from_pandas(
        cls,
        df: Any,  # pandas.DataFrame — type left loose to avoid hard pandas import
        boundaries: Dict[str, Any],
        geoid_column: str,
        variables: Iterable[Dict[str, Any]],
        active_kpi: Optional[str] = None,
        time_axis: Optional[Dict[str, Any]] = None,
        config: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> "LocalVisionWidget":
        """Build a widget directly from a DataFrame + boundary GeoJSON.

        Parameters
        ----------
        df : pandas.DataFrame
            One row per geography (or per geography × time when `time_axis`
            is provided). Must contain the GEOID column.
        boundaries : dict
            GeoJSON FeatureCollection. Each feature's GEOID property is
            joined against `df[geoid_column]`.
        geoid_column : str
            Name of the GEOID column in `df`.
        variables : list of dict
            Variable metadata. Each dict needs `key`, `label`, `format`
            (one of 'number', 'currency', 'percent', 'rate').
        active_kpi : str, optional
            The variable key to start the choropleth on. Defaults to the
            first entry in `variables`.
        time_axis : dict, optional
            { "times": [list of times], "label": "Year" }. Triggers the
            time-slider UI in the widget.
        config : dict, optional
            Forwarded to LocalVisionApp as `config` (theme, default
            view, etc.).
        """
        from .data import dataframe_to_binding

        binding = dataframe_to_binding(
            df,
            boundaries=boundaries,
            geoid_column=geoid_column,
            variables=list(variables),
            time_axis=time_axis,
        )
        kpi = active_kpi or binding["table"]["variables"][0]["key"]
        return cls(binding=binding, active_kpi=kpi, config=config, **kwargs)

    # ── Convenience setters (mutate sync'd traits) ──────────────────────────

    def set_active_kpi(self, kpi: str) -> None:
        """Switch which variable drives the choropleth fill."""
        self.active_kpi = kpi
