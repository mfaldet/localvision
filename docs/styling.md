# Styling

LocalVision ships with a built-in display-settings panel (the ⚙ gear in the header) but every control is also reachable from the public API.

## Themes

Two presets out of the box: `DEFAULT_THEME` (dark) and `LIGHT_THEME`.

```ts
import { LocalVisionApp, LIGHT_THEME } from 'localvision'

new LocalVisionApp({
  container: '#app',
  theme: LIGHT_THEME,
  // ...
})
```

Override individual tokens:

```ts
new LocalVisionApp({
  theme: {
    colorPrimary: '#7c3aed',  // violet
    fontFamily: 'JetBrains Mono, monospace',
    mapStyle: 'mapbox://styles/mapbox/satellite-v9',  // bring your own basemap
  },
  // ...
})
```

## Color schemes

Five sequential / diverging palettes for the choropleth:

| Scheme | Type | Notes |
|---|---|---|
| `default` | Sequential | Blue → green, library default |
| `blues` | Sequential | Single-hue blue ramp |
| `viridis` | Sequential | Perceptually uniform, CB-safe |
| `magma` | Sequential | Black → orange → yellow |
| `redblue` | Diverging | Classic diverging for ratios |
| `cbSafeSequential` | Sequential | ColorBrewer YlGnBu, CB-safe |
| `cbSafeDiverging` | Diverging | ColorBrewer RdYlBu, CB-safe |

```ts
app.outerView?.setStyle({ scheme: 'cbSafeSequential' })
```

## Line + fill controls

```ts
app.outerView?.setStyle({
  fillOpacity: 0.65,            // 0..1
  lineColor: '#fbbf24',         // any hex, or 'auto' to match the bg
  lineWidth: 2,                 // px
  linePattern: 'dashed',        // solid / dashed / dotted / dash-dot
})
```

All settings persist automatically to `localStorage` under `lv_style_config_v1` — they survive page reloads.

## Clip area

Programmatically apply a polygon to dim everything outside it:

```ts
import type { GeoJsonFeature } from 'localvision'

const clipFeature: GeoJsonFeature = {
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates: [/* ... */] },
}

app.outerView?.setClipPolygon(clipFeature)
// later, clear it
app.outerView?.setClipPolygon(null)
```

For interactive drawing, use the **Draw clip area** button in the settings panel.

## Categorical palette (charts)

For your own custom chart marks, an 8-color CB-safe categorical palette:

```ts
import { OKABE_ITO_PALETTE } from 'localvision'

Plot.plot({
  marks: [Plot.barY(data, { fill: 'category', range: OKABE_ITO_PALETTE })],
})
```
