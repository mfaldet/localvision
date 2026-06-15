import maplibregl from 'maplibre-gl'
import * as Plot from '@observablehq/plot'
import type {
  OuterCityOptions,
  CommunityRecord,
  KpiDefinition,
  ChartConfig,
  LocalVisionEventMap,
} from '../types'
import type { DataBinding } from '../data/types'
import { SelectionStore } from '../state/selection'
import { resolveTheme, applyThemeToDom, type ResolvedTheme } from '../theme/tokens'
import { rafThrottle, debounce } from '../util/throttle'

import 'maplibre-gl/dist/maplibre-gl.css'
import '../theme/styles.css'

const COMMUNITIES_SOURCE = 'lv-communities'
const CHOROPLETH_FILL = 'lv-choropleth-fill'
const CHOROPLETH_LINE = 'lv-choropleth-line'

/**
 * Sequential / diverging color palettes for the choropleth fill. Ordered
 * from low → high so the interpolator hands low metric values the first
 * color and high values the last.
 */
export const COLOR_SCHEMES: Record<string, string[]> = {
  default: ['#1e3a5f', '#2563eb', '#60a5fa', '#bfdbfe', '#ecfdf5', '#6ee7b7', '#10b981', '#065f46'],
  blues:   ['#f0f9ff', '#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#0369a1', '#0c4a6e'],
  viridis: ['#440154', '#3b528b', '#21908c', '#5dc863', '#fde725'],
  magma:   ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'],
  redblue: ['#67001f', '#d6604d', '#fddbc7', '#f7f7f7', '#d1e5f0', '#4393c3', '#053061'],
  // Color-blind-safe sequential (ColorBrewer YlGnBu)
  cbSafeSequential: ['#ffffd9', '#edf8b1', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#253494', '#081d58'],
  // Color-blind-safe diverging (ColorBrewer RdYlBu)
  cbSafeDiverging:  ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee090', '#e0f3f8', '#abd9e9', '#74add1', '#4575b4', '#313695'],
}

export type ColorSchemeName = keyof typeof COLOR_SCHEMES

/**
 * Dash patterns for the boundary line layer. Values are arrays of on/off
 * lengths in units of line-width, fed to MapLibre's `line-dasharray`.
 * `solid` uses `[1, 0]` (1 unit on, 0 off = continuous) so we can always
 * set the property without juggling null.
 */
export type LinePatternName = 'solid' | 'dashed' | 'dotted' | 'dash-dot'

const LINE_PATTERNS: Record<LinePatternName, number[]> = {
  solid: [1, 0],
  dashed: [3, 2],
  dotted: [1, 1.5],
  'dash-dot': [3, 1.5, 1, 1.5],
}

/** Style options controllable from the display-settings panel. */
export interface ChoroplethStyleConfig {
  scheme: ColorSchemeName
  /** Base fill opacity (0..1). Hover state adds +0.2, capped at 1. */
  fillOpacity: number
  /**
   * Boundary line color. Pass `'auto'` to use the active theme's
   * background color (high contrast against the choropleth fills).
   */
  lineColor: 'auto' | string
  /** Boundary line width in CSS px (0 hides outlines). */
  lineWidth: number
  /** Dash pattern for the boundary lines. Default 'solid'. */
  linePattern: LinePatternName
}

const DEFAULT_STYLE_CONFIG: ChoroplethStyleConfig = {
  scheme: 'default',
  fillOpacity: 0.65,
  lineColor: 'auto',
  lineWidth: 1,
  linePattern: 'solid',
}
const SELECTED_FILL = 'lv-selected-fill'

export class OuterCityView {
  private root: HTMLElement
  private mapEl: HTMLElement
  private panelEl: HTMLElement
  private kpiSelectorEl: HTMLElement
  private map: maplibregl.Map
  private theme: ResolvedTheme
  private communities: CommunityRecord[]
  private kpiDefs: Map<string, KpiDefinition>
  private activeKpi: string
  private charts: ChartConfig[]
  private splitRatio: number
  private selection: SelectionStore
  private unsubscribeSelection: () => void = () => {}
  private communityFids = new Map<string, number[]>()
  private onDrillRequest?: (c: { id: string; label: string; properties: Record<string, unknown> }) => void
  private activeBinding: DataBinding | null = null
  private currentTime: string | number | null = null
  private styleConfig: ChoroplethStyleConfig = { ...DEFAULT_STYLE_CONFIG }
  /** User-drawn polygon clipping which features are emphasized vs dimmed. */
  private clipPolygon: import('../types').GeoJsonFeature | null = null
  /** True while the user is actively drawing a clip polygon. */
  private isDrawingClip = false
  private clipDrawingState: {
    points: [number, number][]
    onComplete: ((feature: import('../types').GeoJsonFeature | null) => void) | null
    onClick: (e: maplibregl.MapMouseEvent) => void
    onMouseMove: (e: maplibregl.MapMouseEvent) => void
    onDblClick: (e: maplibregl.MapMouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  } | null = null
  private drillButtonLabel?: string
  private listeners: Partial<{ [K in keyof LocalVisionEventMap]: ((e: LocalVisionEventMap[K]) => void)[] }> = {}
  private resizeObserver: ResizeObserver
  /** rAF-batched map repaint for time scrubbing. Created in constructor. */
  private scrubMapUpdate!: ((time: string | number) => void) & { cancel: () => void }
  /** Debounced panel re-render for time scrubbing. Created in constructor. */
  private scrubPanelUpdate!: (() => void) & { cancel: () => void; flush: () => void }

  constructor(options: OuterCityOptions) {
    this.theme = resolveTheme(options.theme)
    this.splitRatio = options.splitRatio ?? 0.5
    this.selection = options.selection ?? new SelectionStore()
    this.onDrillRequest = options.onDrillRequest
    this.drillButtonLabel = options.drillButtonLabel

    // Source of truth: a DataBinding (preferred) or hand-built communities.
    if (options.binding) {
      this.activeBinding = options.binding
      // For temporal bindings, default to the most recent time
      const times = options.binding.table.timeAxis?.times
      this.currentTime = times ? times[times.length - 1] : null
      this.communities = bindingToCommunities(options.binding, this.currentTime)
      const kpiDefs = options.kpiDefs ?? bindingToKpiDefs(options.binding)
      this.kpiDefs = new Map(kpiDefs.map((k) => [k.id, k]))
    } else if (options.communities) {
      this.communities = options.communities
      this.kpiDefs = new Map((options.kpiDefs ?? []).map((k) => [k.id, k]))
    } else {
      throw new Error('[LocalVision] OuterCityView requires either `binding` or `communities`.')
    }

    this.activeKpi = options.activeKpi
    this.charts = options.charts ?? []

    // Resolve container
    this.root = typeof options.container === 'string'
      ? (document.querySelector(options.container) as HTMLElement)
      : options.container

    if (!this.root) throw new Error(`[LocalVision] Container not found: ${options.container}`)

    this.root.classList.add('lv-root')
    this.root.style.flexDirection = 'column'
    applyThemeToDom(this.root, this.theme)

    // KPI selector: render into external header when provided, otherwise own bar
    if (options.headerEl) {
      this.kpiSelectorEl = options.headerEl
    } else {
      this.kpiSelectorEl = document.createElement('div')
      this.kpiSelectorEl.className = 'lv-kpi-selector'
      this.root.appendChild(this.kpiSelectorEl)
    }

    // Body row (map + panel)
    const body = document.createElement('div')
    body.style.cssText = 'display:flex;flex:1;min-height:0;'
    this.root.appendChild(body)

    this.mapEl = document.createElement('div')
    this.mapEl.className = 'lv-map-pane'

    this.panelEl = document.createElement('div')
    this.panelEl.className = 'lv-chart-pane'

    if (options.mapOnly) {
      // Compare-mode layout: map takes full width, chart panel hidden.
      this.mapEl.style.width = '100%'
      this.panelEl.style.display = 'none'
      body.appendChild(this.mapEl)
      body.appendChild(this.panelEl)
    } else {
      this.mapEl.style.width = `${this.splitRatio * 100}%`
      const handle = this.buildResizeHandle(body)
      body.appendChild(this.mapEl)
      body.appendChild(handle)
      body.appendChild(this.panelEl)
    }

    // Init map
    const mapOpts = options.map ?? {}
    this.map = new maplibregl.Map({
      container: this.mapEl,
      style: mapOpts.style ?? this.theme.mapStyle,
      center: mapOpts.center ?? [0, 0],
      zoom: mapOpts.zoom ?? 5,
      bearing: mapOpts.bearing ?? 0,
      pitch: mapOpts.pitch ?? 0,
    })

    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')

    this.map.on('load', () => {
      this.addCommunityLayers()
      this.fitToAllCommunities()
      // Apply any selection state that arrived before the map was ready
      this.syncMapSelection(this.selection.getSnapshot().selected)
    })

    // Cross-component selection: re-render + sync map on every store change.
    this.unsubscribeSelection = this.selection.subscribe((state) => {
      this.syncMapSelection(state.selected)
      this.renderPanel()
    })

    this.renderKpiSelector()
    this.renderPanel()

    // Debounce panel re-render on resize — ResizeObserver fires many times
    // during a drag-resize of the map/panel split; only re-layout charts
    // once the drag settles.
    const debouncedResize = debounce(() => this.renderPanel(), 80)
    this.resizeObserver = new ResizeObserver(() => debouncedResize())
    this.resizeObserver.observe(this.panelEl)

    // Time-scrub performance: coalesce rapid slider updates. The map
    // repaint runs at most once per animation frame (visual smoothness),
    // while the heavier chart-panel re-render waits 120ms after the user
    // stops scrubbing (avoids re-laying-out N Plot charts on every tick).
    this.scrubMapUpdate = rafThrottle((time: string | number) => {
      this.currentTime = time
      this.communities = bindingToCommunities(this.activeBinding!, this.currentTime)
      if (this.map.isStyleLoaded()) {
        const source = this.map.getSource(COMMUNITIES_SOURCE) as
          | maplibregl.GeoJSONSource
          | undefined
        if (source) source.setData(this.buildMergedGeoJson() as GeoJSON.FeatureCollection)
        this.updateChoropleth()
      }
    })
    this.scrubPanelUpdate = debounce(() => this.renderPanel(), 120)
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  setActiveKpi(kpiId: string): void {
    this.activeKpi = kpiId
    this.renderKpiSelector()
    if (this.map.isStyleLoaded()) this.updateChoropleth()
    this.renderPanel()
  }

  on<K extends keyof LocalVisionEventMap>(
    event: K,
    handler: (e: LocalVisionEventMap[K]) => void,
  ): this {
    if (!this.listeners[event]) this.listeners[event] = [] as never
    ;(this.listeners[event] as ((e: LocalVisionEventMap[K]) => void)[]).push(handler)
    return this
  }

  updateCommunities(communities: CommunityRecord[]): void {
    this.communities = communities
    if (this.map.isStyleLoaded()) {
      const src = this.map.getSource(COMMUNITIES_SOURCE) as maplibregl.GeoJSONSource | undefined
      if (src) src.setData(this.buildMergedGeoJson() as GeoJSON.FeatureCollection)
      this.updateChoropleth()
    }
    this.renderPanel()
  }

  /**
   * Replace the current binding with a new one — used by drill-down to swap
   * the choropleth data in place (e.g. from "MN counties" to "Hennepin
   * County tracts"). The map source is updated rather than torn down,
   * selection is cleared (old GEOIDs no longer apply), and the camera
   * flies to the new extent.
   */
  updateBinding(binding: DataBinding): void {
    this.activeBinding = binding
    // Reset currentTime: prefer the most recent if the new binding is temporal
    const times = binding.table.timeAxis?.times
    this.currentTime = times ? times[times.length - 1] : null

    this.communities = bindingToCommunities(binding, this.currentTime)
    const kpiDefs = bindingToKpiDefs(binding)
    this.kpiDefs = new Map(kpiDefs.map((k) => [k.id, k]))

    // Fall back to first available KPI if the previous active one is gone
    // OR is no longer available at the new boundary level.
    const newLevel = binding.table.meta?.geographyLevel
    const activeDef = this.kpiDefs.get(this.activeKpi)
    const activeStillOk =
      !!activeDef &&
      (!newLevel ||
        !activeDef.availableAtLevels ||
        activeDef.availableAtLevels.length === 0 ||
        activeDef.availableAtLevels.includes(newLevel))
    if (!activeStillOk) {
      // Pick first KPI compatible with the new level
      const compatible = [...this.kpiDefs.values()].find(
        (d) =>
          !newLevel ||
          !d.availableAtLevels ||
          d.availableAtLevels.length === 0 ||
          d.availableAtLevels.includes(newLevel),
      )
      if (compatible) this.activeKpi = compatible.id
    }

    this.selection.clear()

    if (this.map.isStyleLoaded()) {
      const source = this.map.getSource(COMMUNITIES_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined
      if (source) {
        source.setData(this.buildMergedGeoJson() as GeoJSON.FeatureCollection)
      } else {
        this.addCommunityLayers()
      }
      this.updateChoropleth()
      this.fitToAllCommunities()
    } else {
      this.map.once('load', () => {
        this.addCommunityLayers()
        this.fitToAllCommunities()
      })
    }

    this.renderKpiSelector()
    this.renderPanel()
    // New features need their clipped feature-state recomputed
    if (this.clipPolygon) this.refreshClipState()
  }

  /**
   * Set the active time for a temporal binding. Re-derives community values
   * from the table for the requested time and updates the choropleth source
   * (no layer teardown, no camera move — just data swap). No-op if the
   * current binding isn't temporal or the time is unchanged.
   */
  setCurrentTime(time: string | number): void {
    if (!this.activeBinding?.table.timeAxis) return
    if (time === this.currentTime) return

    // Map repaint: rAF-batched so rapid scrubbing renders at most once per
    // frame with the latest value. Panel re-render: debounced so the
    // (heavier) Plot chart layout only happens once the user pauses.
    // No fitToAllCommunities — boundaries haven't changed, only values.
    this.scrubMapUpdate(time)
    this.scrubPanelUpdate()
  }

  /**
   * Update the choropleth's visual style (fill color scheme + opacity,
   * boundary line color + width). Only the keys present in `opts` are
   * changed; everything else keeps its current value. Idempotent: safe to
   * call before the map style has loaded — settings apply on load.
   */
  setStyle(opts: Partial<ChoroplethStyleConfig>): void {
    this.styleConfig = { ...this.styleConfig, ...opts }
    if (this.map.isStyleLoaded()) {
      this.applyStyleConfig()
    } else {
      this.map.once('load', () => this.applyStyleConfig())
    }
  }

  /** Read the current style config (useful for restoring settings panels). */
  getStyle(): ChoroplethStyleConfig {
    return { ...this.styleConfig }
  }

  /**
   * Expose the underlying MapLibre map. Used by LocalVisionApp's
   * comparison mode to wire pan/zoom sync between two views. Avoid
   * mutating layers / sources directly — prefer the public setters.
   */
  getMap(): maplibregl.Map {
    return this.map
  }

  // ── Annotation markers ──────────────────────────────────────────────────────

  /**
   * Replace all annotation markers on the map. Renders each as a small
   * circle + a text label above it. Idempotent — call on every store
   * change; the source data is swapped in place.
   */
  setAnnotationMarkers(
    markers: { id: string; lngLat: [number, number]; label: string; color?: string }[],
  ): void {
    const apply = () => {
      const SOURCE = 'lv-annotations'
      const DOT = 'lv-annotation-dot'
      const LABEL = 'lv-annotation-label'

      const fc = {
        type: 'FeatureCollection',
        features: markers.map((m) => ({
          type: 'Feature',
          properties: { id: m.id, label: m.label, color: m.color ?? '#fbbf24' },
          geometry: { type: 'Point', coordinates: m.lngLat },
        })),
      } as unknown as GeoJSON.FeatureCollection

      const existing = this.map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined
      if (existing) {
        existing.setData(fc)
        return
      }
      this.map.addSource(SOURCE, { type: 'geojson', data: fc })
      this.map.addLayer({
        id: DOT,
        type: 'circle',
        source: SOURCE,
        paint: {
          'circle-radius': 6,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })
      this.map.addLayer({
        id: LABEL,
        type: 'symbol',
        source: SOURCE,
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 12,
          'text-offset': [0, -1.4],
          'text-anchor': 'bottom',
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#000000',
          'text-halo-width': 1.5,
        },
      })
    }
    if (this.map.isStyleLoaded()) apply()
    else this.map.once('load', apply)
  }

  /**
   * Begin interactive marker placement. The next map click resolves the
   * callback with the clicked [lng, lat]; Esc cancels (resolves null).
   * The cursor switches to crosshair during placement.
   */
  startMarkerPlacement(onPlace: (lngLat: [number, number] | null) => void): void {
    this.mapEl.style.cursor = 'crosshair'
    const cleanup = () => {
      this.mapEl.style.cursor = ''
      this.map.off('click', onClick)
      window.removeEventListener('keydown', onKey)
    }
    const onClick = (e: maplibregl.MapMouseEvent) => {
      cleanup()
      onPlace([e.lngLat.lng, e.lngLat.lat])
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup()
        onPlace(null)
      }
    }
    this.map.on('click', onClick)
    window.addEventListener('keydown', onKey)
  }

  // ── Annotation shapes (freehand polygons / lines) ───────────────────────────

  /**
   * Replace all annotation shapes (polygons + lines). Polygons render
   * as a translucent fill + outline; lines as a stroked path. Each
   * optional label appears at the shape's centroid. Idempotent.
   */
  setAnnotationShapes(
    shapes: { id: string; kind: 'polygon' | 'line'; points: [number, number][]; label?: string; color?: string }[],
  ): void {
    const apply = () => {
      const FILL_SRC = 'lv-ann-shape-fill'
      const LINE_SRC = 'lv-ann-shape-line'
      const LABEL_SRC = 'lv-ann-shape-label'
      const FILL = 'lv-ann-shape-fill-layer'
      const OUTLINE = 'lv-ann-shape-outline-layer'
      const LINE = 'lv-ann-shape-line-layer'
      const LABEL = 'lv-ann-shape-label-layer'

      const polys = shapes.filter((s) => s.kind === 'polygon')
      const lines = shapes.filter((s) => s.kind === 'line')

      const polyFc = {
        type: 'FeatureCollection',
        features: polys.map((s) => ({
          type: 'Feature',
          properties: { id: s.id, color: s.color ?? '#fbbf24' },
          geometry: { type: 'Polygon', coordinates: [closeRing(s.points)] },
        })),
      } as unknown as GeoJSON.FeatureCollection

      const lineFc = {
        type: 'FeatureCollection',
        features: lines.map((s) => ({
          type: 'Feature',
          properties: { id: s.id, color: s.color ?? '#fbbf24' },
          geometry: { type: 'LineString', coordinates: s.points },
        })),
      } as unknown as GeoJSON.FeatureCollection

      const labelFc = {
        type: 'FeatureCollection',
        features: shapes
          .filter((s) => s.label)
          .map((s) => ({
            type: 'Feature',
            properties: { label: s.label, color: s.color ?? '#fbbf24' },
            geometry: { type: 'Point', coordinates: centroid(s.points) },
          })),
      } as unknown as GeoJSON.FeatureCollection

      // Polygons (fill + outline)
      const existingFill = this.map.getSource(FILL_SRC) as maplibregl.GeoJSONSource | undefined
      if (existingFill) {
        existingFill.setData(polyFc)
      } else {
        this.map.addSource(FILL_SRC, { type: 'geojson', data: polyFc })
        this.map.addLayer({
          id: FILL, type: 'fill', source: FILL_SRC,
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.18 },
        })
        this.map.addLayer({
          id: OUTLINE, type: 'line', source: FILL_SRC,
          paint: { 'line-color': ['get', 'color'], 'line-width': 2 },
        })
      }

      // Lines
      const existingLine = this.map.getSource(LINE_SRC) as maplibregl.GeoJSONSource | undefined
      if (existingLine) {
        existingLine.setData(lineFc)
      } else {
        this.map.addSource(LINE_SRC, { type: 'geojson', data: lineFc })
        this.map.addLayer({
          id: LINE, type: 'line', source: LINE_SRC,
          paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.9 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        })
      }

      // Labels
      const existingLabel = this.map.getSource(LABEL_SRC) as maplibregl.GeoJSONSource | undefined
      if (existingLabel) {
        existingLabel.setData(labelFc)
      } else {
        this.map.addSource(LABEL_SRC, { type: 'geojson', data: labelFc })
        this.map.addLayer({
          id: LABEL, type: 'symbol', source: LABEL_SRC,
          layout: {
            'text-field': ['get', 'label'],
            'text-size': 12,
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#000000',
            'text-halo-width': 1.5,
          },
        })
      }
    }
    if (this.map.isStyleLoaded()) apply()
    else this.map.once('load', apply)
  }

  /**
   * Begin freehand shape drawing. `kind` selects polygon (closed) or
   * line (open). Click adds vertices; double-click finishes; Esc cancels.
   * A live amber preview follows the cursor. The callback resolves with
   * the finished point list (>= 2 for lines, >= 3 for polygons) or null
   * on cancel.
   */
  startShapeDrawing(
    kind: 'polygon' | 'line',
    onComplete: (points: [number, number][] | null) => void,
  ): void {
    this.mapEl.style.cursor = 'crosshair'
    this.map.doubleClickZoom.disable()
    const points: [number, number][] = []

    const cleanup = () => {
      this.mapEl.style.cursor = ''
      this.map.doubleClickZoom.enable()
      this.map.off('click', onClick)
      this.map.off('mousemove', onMove)
      this.map.off('dblclick', onDbl)
      window.removeEventListener('keydown', onKey)
      this.updateShapePreview([], kind)
    }
    const onClick = (e: maplibregl.MapMouseEvent) => {
      points.push([e.lngLat.lng, e.lngLat.lat])
      this.updateShapePreview(points, kind)
    }
    const onMove = (e: maplibregl.MapMouseEvent) => {
      if (points.length === 0) return
      this.updateShapePreview([...points, [e.lngLat.lng, e.lngLat.lat]], kind)
    }
    const onDbl = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault?.()
      const min = kind === 'polygon' ? 3 : 2
      if (points.length < min) {
        cleanup()
        onComplete(null)
        return
      }
      cleanup()
      onComplete([...points])
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup()
        onComplete(null)
      }
    }

    this.map.on('click', onClick)
    this.map.on('mousemove', onMove)
    this.map.on('dblclick', onDbl)
    window.addEventListener('keydown', onKey)
  }

  private updateShapePreview(points: [number, number][], kind: 'polygon' | 'line'): void {
    const SRC = 'lv-shape-preview'
    const LINE = 'lv-shape-preview-line'
    const VERTS = 'lv-shape-preview-verts'

    if (points.length === 0) {
      if (this.map.getLayer(LINE)) this.map.removeLayer(LINE)
      if (this.map.getLayer(VERTS)) this.map.removeLayer(VERTS)
      if (this.map.getSource(SRC)) this.map.removeSource(SRC)
      return
    }

    // For polygon preview, close the ring visually once we have 3+ pts.
    const previewLine = kind === 'polygon' && points.length >= 3
      ? closeRing(points)
      : points

    const data = {
      type: 'FeatureCollection',
      features: [
        ...(points.length >= 2
          ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: previewLine } }]
          : []),
        ...points.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } })),
      ],
    } as unknown as GeoJSON.FeatureCollection

    const existing = this.map.getSource(SRC) as maplibregl.GeoJSONSource | undefined
    if (existing) {
      existing.setData(data)
    } else {
      this.map.addSource(SRC, { type: 'geojson', data })
      this.map.addLayer({
        id: LINE, type: 'line', source: SRC,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#fbbf24', 'line-width': 2, 'line-dasharray': [2, 2] },
      })
      this.map.addLayer({
        id: VERTS, type: 'circle', source: SRC,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': '#fbbf24', 'circle-radius': 4,
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2,
        },
      })
    }
  }

  // ── Camera snapshot / restore (for bookmarks) ───────────────────────────────

  /** Capture the current camera as a plain object (for bookmarks). */
  getCamera(): { center: [number, number]; zoom: number; bearing: number; pitch: number } {
    const c = this.map.getCenter()
    return {
      center: [c.lng, c.lat],
      zoom: this.map.getZoom(),
      bearing: this.map.getBearing(),
      pitch: this.map.getPitch(),
    }
  }

  /** Fly the camera to a saved snapshot. */
  flyToCamera(
    cam: { center: [number, number]; zoom: number; bearing: number; pitch: number },
    durationMs = 900,
  ): void {
    this.map.flyTo({
      center: cam.center,
      zoom: cam.zoom,
      bearing: cam.bearing,
      pitch: cam.pitch,
      duration: durationMs,
    })
  }

  /**
   * Add or replace a "city focus" overlay — the chosen city's polygon drawn
   * as a bold red outline on top of everything. Always visible regardless
   * of the active boundary level. Pass null to clear.
   */
  setCityFocus(feature: import('../types').GeoJsonFeature | null): void {
    const apply = () => {
      const SOURCE = 'lv-city-focus'
      const FILL   = 'lv-city-focus-fill'
      const LINE   = 'lv-city-focus-line'
      const HALO   = 'lv-city-focus-halo'

      if (!feature) {
        if (this.map.getLayer(LINE))   this.map.removeLayer(LINE)
        if (this.map.getLayer(HALO))   this.map.removeLayer(HALO)
        if (this.map.getLayer(FILL))   this.map.removeLayer(FILL)
        if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE)
        return
      }

      const fc: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [feature as unknown as GeoJSON.Feature],
      }

      if (this.map.getSource(SOURCE)) {
        ;(this.map.getSource(SOURCE) as maplibregl.GeoJSONSource).setData(fc)
      } else {
        this.map.addSource(SOURCE, { type: 'geojson', data: fc })
        // Subtle fill so the city's body is just slightly tinted
        this.map.addLayer({
          id: FILL,
          type: 'fill',
          source: SOURCE,
          paint: { 'fill-color': '#FF3B30', 'fill-opacity': 0.08 },
        })
        // White halo underneath the red line for contrast over dark + light bases
        this.map.addLayer({
          id: HALO,
          type: 'line',
          source: SOURCE,
          paint: {
            'line-color': '#ffffff',
            'line-width': 6,
            'line-opacity': 0.45,
            'line-blur': 1,
          },
        })
        this.map.addLayer({
          id: LINE,
          type: 'line',
          source: SOURCE,
          paint: {
            'line-color': '#FF3B30',
            'line-width': 3,
            'line-opacity': 0.95,
          },
        })
      }
    }

    if (this.map.isStyleLoaded()) apply()
    else this.map.once('load', apply)
  }

  /**
   * Add or replace a boundary overlay layer on the map.
   * Draws on top of the choropleth. Pass null to clear.
   */
  setBoundaryLayer(geojson: import('../types').GeoJsonFeatureCollection | null): void {
    const apply = () => {
      const SOURCE = 'lv-overlay'
      const LINE   = 'lv-overlay-line'

      if (!geojson) {
        if (this.map.getLayer(LINE))    this.map.removeLayer(LINE)
        if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE)
        return
      }

      if (this.map.getSource(SOURCE)) {
        (this.map.getSource(SOURCE) as maplibregl.GeoJSONSource)
          .setData(geojson as GeoJSON.FeatureCollection)
      } else {
        this.map.addSource(SOURCE, { type: 'geojson', data: geojson as GeoJSON.FeatureCollection })
        // Outer view: lines only so choropleth colors still read clearly
        this.map.addLayer({
          id: LINE, type: 'line', source: SOURCE,
          paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 0.4 },
        })
      }
    }

    if (this.map.isStyleLoaded()) apply()
    else this.map.once('load', apply)
  }

  // ── Custom map layers ───────────────────────────────────────────────────────

  /**
   * Add a user-supplied GeoJSON layer on top of the choropleth. The
   * caller controls the visual via `paint` / `layout` props; LocalVision
   * just owns the lifecycle (creating sources, swapping data, ordering).
   *
   * Multiple calls with the same `id` replace the source data in-place.
   */
  addCustomLayer(opts: {
    id: string
    type: 'fill' | 'line' | 'circle' | 'symbol'
    source: import('../types').GeoJsonFeatureCollection
    paint?: Record<string, unknown>
    layout?: Record<string, unknown>
  }): void {
    const apply = () => {
      const sourceId = `lv-custom-${opts.id}`
      const layerId = `lv-custom-${opts.id}`
      const existing = this.map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
      if (existing) {
        existing.setData(opts.source as unknown as GeoJSON.FeatureCollection)
        return
      }
      this.map.addSource(sourceId, {
        type: 'geojson',
        data: opts.source as unknown as GeoJSON.FeatureCollection,
      })
      // Insert below the city-focus + clip overlays so they stay
      // visible on top. Falls through to top-of-stack if neither exists.
      const beforeId = this.map.getLayer('lv-city-focus-halo')
        ? 'lv-city-focus-halo'
        : this.map.getLayer('lv-clip-area-line')
          ? 'lv-clip-area-line'
          : undefined
      this.map.addLayer(
        {
          id: layerId,
          type: opts.type,
          source: sourceId,
          paint: (opts.paint ?? {}) as maplibregl.LayerSpecification['paint'],
          layout: (opts.layout ?? {}) as maplibregl.LayerSpecification['layout'],
        } as maplibregl.LayerSpecification,
        beforeId,
      )
    }
    if (this.map.isStyleLoaded()) apply()
    else this.map.once('load', apply)
  }

  /** Remove a custom layer previously added via addCustomLayer. */
  removeCustomLayer(id: string): void {
    const sourceId = `lv-custom-${id}`
    const layerId = `lv-custom-${id}`
    if (this.map.getLayer(layerId)) this.map.removeLayer(layerId)
    if (this.map.getSource(sourceId)) this.map.removeSource(sourceId)
  }

  /** Toggle visibility of a custom layer without removing it. */
  setCustomLayerVisibility(id: string, visible: boolean): void {
    const layerId = `lv-custom-${id}`
    if (!this.map.getLayer(layerId)) return
    this.map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
  }

  /**
   * Change a custom layer's opacity. Routes to the right paint property
   * for the layer type (fill/line/circle/symbol).
   */
  setCustomLayerOpacity(id: string, opacity: number): void {
    const layerId = `lv-custom-${id}`
    const layer = this.map.getLayer(layerId)
    if (!layer) return
    const t = layer.type
    if (t === 'fill')   this.map.setPaintProperty(layerId, 'fill-opacity', opacity)
    if (t === 'line')   this.map.setPaintProperty(layerId, 'line-opacity', opacity)
    if (t === 'circle') {
      this.map.setPaintProperty(layerId, 'circle-opacity', opacity)
      this.map.setPaintProperty(layerId, 'circle-stroke-opacity', opacity)
    }
    if (t === 'symbol') {
      this.map.setPaintProperty(layerId, 'icon-opacity', opacity)
      this.map.setPaintProperty(layerId, 'text-opacity', opacity)
    }
  }

  // ── Clip-area API ───────────────────────────────────────────────────────────

  /** Read the current clip polygon (null when no clip is active). */
  getClipPolygon(): import('../types').GeoJsonFeature | null {
    return this.clipPolygon
  }

  /**
   * Set / replace / clear the clip polygon. Features whose centroid sits
   * outside the polygon get a 'clipped' feature-state, which the fill-
   * opacity expression dims to ~5%. Pass null to remove the clip.
   */
  setClipPolygon(feature: import('../types').GeoJsonFeature | null): void {
    this.clipPolygon = feature
    if (this.map.isStyleLoaded()) {
      this.refreshClipState()
    } else {
      this.map.once('load', () => this.refreshClipState())
    }
  }

  /**
   * Begin drawing a clip polygon. Cursor goes crosshair; left-click adds
   * vertices, double-click closes the polygon, Esc cancels. The callback
   * fires once with the resulting feature (or null on cancel).
   */
  startClipDrawing(
    onComplete: (feature: import('../types').GeoJsonFeature | null) => void,
  ): void {
    if (this.isDrawingClip) return
    this.isDrawingClip = true
    this.mapEl.style.cursor = 'crosshair'

    const points: [number, number][] = []
    const updatePreview = () => this.updateClipPreview(points)

    const onClick = (e: maplibregl.MapMouseEvent) => {
      points.push([e.lngLat.lng, e.lngLat.lat])
      updatePreview()
    }
    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (points.length === 0) return
      this.updateClipPreview([...points, [e.lngLat.lng, e.lngLat.lat]])
    }
    const onDblClick = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault?.()
      // dblclick fires after two clicks → the second point is already in.
      // Need at least 3 distinct points for a polygon.
      if (points.length < 3) {
        this.cancelClipDrawing()
        onComplete(null)
        return
      }
      // Close the ring by repeating the first point
      const ring: [number, number][] = [...points, points[0]]
      const feature: import('../types').GeoJsonFeature = {
        type: 'Feature',
        properties: { _lv_clip: true },
        geometry: { type: 'Polygon', coordinates: [ring] },
      }
      this.cancelClipDrawing()
      onComplete(feature)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.cancelClipDrawing()
        onComplete(null)
      }
    }

    this.map.on('click', onClick)
    this.map.on('mousemove', onMouseMove)
    this.map.on('dblclick', onDblClick)
    this.map.doubleClickZoom.disable()
    window.addEventListener('keydown', onKeyDown)

    this.clipDrawingState = { points, onComplete, onClick, onMouseMove, onDblClick, onKeyDown }
  }

  /** Abort an in-flight drawing session and tear down its listeners + preview. */
  cancelClipDrawing(): void {
    if (!this.isDrawingClip || !this.clipDrawingState) return
    const s = this.clipDrawingState
    this.map.off('click', s.onClick)
    this.map.off('mousemove', s.onMouseMove)
    this.map.off('dblclick', s.onDblClick)
    this.map.doubleClickZoom.enable()
    window.removeEventListener('keydown', s.onKeyDown)
    this.mapEl.style.cursor = ''
    this.isDrawingClip = false
    this.clipDrawingState = null
    // Wipe live preview
    this.updateClipPreview([])
  }

  destroy(): void {
    this.scrubMapUpdate?.cancel()
    this.scrubPanelUpdate?.cancel()
    this.unsubscribeSelection()
    this.resizeObserver.disconnect()
    this.map.remove()
    this.root.innerHTML = ''
    this.root.classList.remove('lv-root')
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Fill-opacity expression that respects three feature states:
   *   - clipped: outside an active clip polygon → strongly dimmed (0.05)
   *   - hover:   pointer over feature → +0.2 over base
   *   - default: base opacity from styleConfig
   */
  private fillOpacityExpression(): maplibregl.ExpressionSpecification {
    const base = this.styleConfig.fillOpacity
    const hover = Math.min(1, base + 0.2)
    return [
      'case',
      ['boolean', ['feature-state', 'clipped'], false], 0.05,
      ['boolean', ['feature-state', 'hover'], false], hover,
      base,
    ] as unknown as maplibregl.ExpressionSpecification
  }

  /** Resolve the 'auto' line-color sentinel against the active theme. */
  private resolveLineColor(): string {
    return this.styleConfig.lineColor === 'auto'
      ? this.theme.colorBackground
      : this.styleConfig.lineColor
  }

  /**
   * Push the current styleConfig into the live MapLibre layers. Safe to
   * call when layers aren't yet created — it's a no-op in that case.
   */
  /**
   * Live drawing preview. Adds/updates a temporary LineString that follows
   * the in-progress vertices. Pass an empty array to clear the preview.
   */
  private updateClipPreview(points: [number, number][]): void {
    const SRC = 'lv-clip-preview'
    const LINE = 'lv-clip-preview-line'
    const VERTS = 'lv-clip-preview-verts'

    if (points.length === 0) {
      if (this.map.getLayer(LINE)) this.map.removeLayer(LINE)
      if (this.map.getLayer(VERTS)) this.map.removeLayer(VERTS)
      if (this.map.getSource(SRC)) this.map.removeSource(SRC)
      return
    }

    const data = {
      type: 'FeatureCollection',
      features: [
        ...(points.length >= 2
          ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points } }]
          : []),
        ...points.map((p) => ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: p },
        })),
      ],
    } as unknown as GeoJSON.FeatureCollection

    const existing = this.map.getSource(SRC) as maplibregl.GeoJSONSource | undefined
    if (existing) {
      existing.setData(data)
    } else {
      this.map.addSource(SRC, { type: 'geojson', data })
      this.map.addLayer({
        id: LINE,
        type: 'line',
        source: SRC,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': '#fbbf24',
          'line-width': 2,
          'line-dasharray': [2, 2],
        },
      })
      this.map.addLayer({
        id: VERTS,
        type: 'circle',
        source: SRC,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': '#fbbf24',
          'circle-radius': 4,
          'circle-stroke-color': this.theme.colorBackground,
          'circle-stroke-width': 2,
        },
      })
    }
  }

  /**
   * Apply / update / clear the clip polygon's visual state:
   *   - The polygon outline (dashed amber) is rendered as a new layer.
   *   - For each community feature, point-in-polygon on its bbox center
   *     decides whether to set feature-state 'clipped' = true (outside).
   *   - When clipPolygon is null, all clipped state is cleared.
   */
  private refreshClipState(): void {
    const SRC = 'lv-clip-area'
    const LINE = 'lv-clip-area-line'

    if (!this.clipPolygon) {
      // Clear feature-state.clipped on every community
      for (const [, fids] of this.communityFids) {
        for (const fid of fids) {
          this.map.setFeatureState({ source: COMMUNITIES_SOURCE, id: fid }, { clipped: false })
        }
      }
      if (this.map.getLayer(LINE)) this.map.removeLayer(LINE)
      if (this.map.getSource(SRC)) this.map.removeSource(SRC)
      return
    }

    // Render the clip-area outline as a thin dashed amber line
    const data = {
      type: 'FeatureCollection',
      features: [this.clipPolygon as unknown as GeoJSON.Feature],
    } as GeoJSON.FeatureCollection
    const existing = this.map.getSource(SRC) as maplibregl.GeoJSONSource | undefined
    if (existing) {
      existing.setData(data)
    } else {
      this.map.addSource(SRC, { type: 'geojson', data })
      this.map.addLayer({
        id: LINE,
        type: 'line',
        source: SRC,
        paint: {
          'line-color': '#fbbf24',
          'line-width': 1.5,
          'line-dasharray': [4, 2],
          'line-opacity': 0.9,
        },
      })
    }

    // Mark features whose bbox center is outside the polygon as clipped
    // Dynamic import to avoid circular dep on spatial; both live in src.
    void import('../geo/spatial').then(({ bboxCenter, pointInPolygon }) => {
      for (const c of this.communities) {
        const fids = this.communityFids.get(c.id) ?? []
        let inside = false
        for (const f of c.geojson.features) {
          if (pointInPolygon(bboxCenter(f.geometry), this.clipPolygon!.geometry)) {
            inside = true
            break
          }
        }
        for (const fid of fids) {
          this.map.setFeatureState({ source: COMMUNITIES_SOURCE, id: fid }, { clipped: !inside })
        }
      }
    })
  }

  private applyStyleConfig(): void {
    if (this.map.getLayer(CHOROPLETH_FILL)) {
      this.map.setPaintProperty(CHOROPLETH_FILL, 'fill-color', this.buildColorExpression())
      this.map.setPaintProperty(CHOROPLETH_FILL, 'fill-opacity', this.fillOpacityExpression())
    }
    if (this.map.getLayer(CHOROPLETH_LINE)) {
      this.map.setPaintProperty(CHOROPLETH_LINE, 'line-color', this.resolveLineColor())
      this.map.setPaintProperty(CHOROPLETH_LINE, 'line-width', this.styleConfig.lineWidth)
      this.map.setPaintProperty(
        CHOROPLETH_LINE,
        'line-dasharray',
        LINE_PATTERNS[this.styleConfig.linePattern],
      )
    }
  }

  private buildMergedGeoJson() {
    const features: unknown[] = []
    this.communityFids.clear()
    let nextId = 0
    for (const c of this.communities) {
      const fids: number[] = []
      for (const f of c.geojson.features) {
        features.push({
          ...f,
          id: nextId,
          properties: { ...f.properties, _lv_id: c.id, _lv_label: c.label, ...c.kpis },
        })
        fids.push(nextId)
        nextId++
      }
      this.communityFids.set(c.id, fids)
    }
    return { type: 'FeatureCollection', features }
  }

  private addCommunityLayers(): void {
    this.map.addSource(COMMUNITIES_SOURCE, {
      type: 'geojson',
      data: this.buildMergedGeoJson() as GeoJSON.FeatureCollection,
    })

    // Choropleth fill — color driven by active KPI + user-selected scheme
    this.map.addLayer({
      id: CHOROPLETH_FILL,
      type: 'fill',
      source: COMMUNITIES_SOURCE,
      paint: {
        'fill-color': this.buildColorExpression(),
        'fill-opacity': this.fillOpacityExpression(),
      },
    })

    this.map.addLayer({
      id: SELECTED_FILL,
      type: 'fill',
      source: COMMUNITIES_SOURCE,
      paint: {
        'fill-color': this.theme.colorAccent,
        'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.35, 0],
      },
    })

    this.map.addLayer({
      id: CHOROPLETH_LINE,
      type: 'line',
      source: COMMUNITIES_SOURCE,
      paint: {
        'line-color': this.resolveLineColor(),
        'line-width': this.styleConfig.lineWidth,
        'line-opacity': 0.8,
        'line-dasharray': LINE_PATTERNS[this.styleConfig.linePattern],
      },
    })

    // Hover
    let hoveredId: string | number | null = null
    const tooltip = this.buildTooltip()

    this.map.on('mousemove', CHOROPLETH_FILL, (e) => {
      if (!e.features?.length) return
      if (hoveredId !== null) {
        this.map.setFeatureState({ source: COMMUNITIES_SOURCE, id: hoveredId }, { hover: false })
      }
      hoveredId = e.features[0].id ?? null
      if (hoveredId !== null) {
        this.map.setFeatureState({ source: COMMUNITIES_SOURCE, id: hoveredId }, { hover: true })
      }
      this.map.getCanvas().style.cursor = 'pointer'

      const props = e.features[0].properties as Record<string, unknown>
      this.showTooltip(tooltip, e.point, props)
    })

    this.map.on('mouseleave', CHOROPLETH_FILL, () => {
      if (hoveredId !== null) {
        this.map.setFeatureState({ source: COMMUNITIES_SOURCE, id: hoveredId }, { hover: false })
      }
      hoveredId = null
      this.map.getCanvas().style.cursor = ''
      tooltip.style.opacity = '0'
    })

    this.map.on('click', CHOROPLETH_FILL, (e) => {
      if (!e.features?.length) return
      const props = e.features[0].properties as Record<string, string>
      const cid = props['_lv_id'] ?? null

      // Dispatch to store — subscription handles visual updates
      if (cid) this.selection.selectFeatures([cid], 'replace')

      this.emit('featureSelect', {
        featureId: cid,
        properties: props,
        lngLat: [e.lngLat.lng, e.lngLat.lat],
      })
    })
  }

  /**
   * Apply current selection state to map feature-state. Called from the
   * store subscription so the map stays in sync regardless of who
   * dispatched the change.
   */
  private syncMapSelection(selected: ReadonlySet<string>): void {
    if (!this.map.isStyleLoaded()) return
    this.communityFids.forEach((fids, geoid) => {
      const isSelected = selected.has(geoid)
      for (const fid of fids) {
        this.map.setFeatureState(
          { source: COMMUNITIES_SOURCE, id: fid },
          { selected: isSelected },
        )
      }
    })
  }

  private buildColorExpression(): maplibregl.ExpressionSpecification {
    const kpiDef = this.kpiDefs.get(this.activeKpi)
    // Per-KPI override wins; otherwise use the user-selected scheme; otherwise default.
    const palette =
      kpiDef?.colorScale ??
      COLOR_SCHEMES[this.styleConfig.scheme] ??
      COLOR_SCHEMES.default
    const values = this.communities.map((c) => c.kpis[this.activeKpi] ?? 0)
    const min = Math.min(...values)
    const max = Math.max(...values)

    if (min === max) return ['literal', palette[Math.floor(palette.length / 2)]] as unknown as maplibregl.ExpressionSpecification

    const steps = palette.length
    const stepSize = (max - min) / steps

    const stops: (string | number)[] = []
    palette.forEach((color, i) => {
      stops.push(min + i * stepSize, color)
    })

    return [
      'interpolate',
      ['linear'],
      ['get', this.activeKpi],
      ...stops,
    ] as unknown as maplibregl.ExpressionSpecification
  }

  private updateChoropleth(): void {
    this.map.setPaintProperty(CHOROPLETH_FILL, 'fill-color', this.buildColorExpression())
  }

  private fitToAllCommunities(): void {
    const bounds = new maplibregl.LngLatBounds()
    this.communities.forEach((c) => {
      c.geojson.features.forEach((f) => {
        collectCoords(f.geometry).forEach(([lng, lat]) => bounds.extend([lng, lat]))
      })
    })
    if (!bounds.isEmpty()) {
      this.map.fitBounds(bounds, { padding: 48, duration: 800 })
    }
  }

  private renderKpiSelector(): void {
    this.kpiSelectorEl.innerHTML = ''
    const level = this.activeBinding?.table.meta?.geographyLevel
    this.kpiDefs.forEach((def) => {
      // Filter KPIs to those declared as available at the current boundary
      // level. Undefined / empty `availableAtLevels` means universal.
      const ok =
        !level ||
        !def.availableAtLevels ||
        def.availableAtLevels.length === 0 ||
        def.availableAtLevels.includes(level)
      if (!ok) return
      const pill = document.createElement('button')
      pill.className = `lv-kpi-pill${def.id === this.activeKpi ? ' lv-active' : ''}`
      pill.textContent = def.label
      pill.addEventListener('click', () => this.setActiveKpi(def.id))
      this.kpiSelectorEl.appendChild(pill)
    })
  }

  private renderPanel(): void {
    this.panelEl.innerHTML = ''
    const panelWidth = this.panelEl.clientWidth || 400
    const selectedIds = this.selection.getSnapshot().selected
    // Single-select shows detail view; 0 or multi shows comparison
    const singleId = selectedIds.size === 1 ? [...selectedIds][0] : null
    const selected = singleId ? this.communities.find((c) => c.id === singleId) : null

    if (selected) {
      this.renderCommunityDetail(selected, panelWidth)
    } else {
      this.renderComparisonCharts(panelWidth)
    }
  }

  private renderCommunityDetail(community: CommunityRecord, width: number): void {
    const header = document.createElement('div')
    header.className = 'lv-chart-card'
    header.style.borderBottom = `1px solid ${this.theme.colorBorder}`

    const name = document.createElement('p')
    name.style.cssText = `margin:0 0 4px;font-size:16px;font-weight:600;color:${this.theme.colorText}`
    name.textContent = community.label
    header.appendChild(name)

    if (community.meta) {
      Object.entries(community.meta).forEach(([k, v]) => {
        const row = document.createElement('p')
        row.style.cssText = `margin:2px 0;font-size:12px;color:${this.theme.colorTextMuted}`
        row.textContent = `${k}: ${v}`
        header.appendChild(row)
      })
    }

    const btnRow = document.createElement('div')
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;'

    const backBtn = document.createElement('button')
    backBtn.style.cssText = `background:none;border:1px solid ${this.theme.colorBorder};color:${this.theme.colorTextMuted};padding:4px 10px;border-radius:4px;font-size:11px;cursor:pointer;`
    backBtn.textContent = '← All communities'
    backBtn.addEventListener('click', () => this.selection.clear())
    btnRow.appendChild(backBtn)

    // Drill-down button — only shown when a callback is provided
    if (this.onDrillRequest) {
      const drillBtn = document.createElement('button')
      drillBtn.style.cssText = `background:${this.theme.colorPrimary};border:1px solid ${this.theme.colorPrimary};color:${this.theme.colorBackground};padding:4px 10px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;`
      drillBtn.textContent = this.drillButtonLabel ?? `Drill into ${community.label} ↓`
      const feature = community.geojson.features[0]
      const props = (feature?.properties as Record<string, unknown>) ?? {}
      drillBtn.addEventListener('click', () => {
        this.onDrillRequest?.({
          id: community.id,
          label: community.label,
          properties: props,
        })
      })
      btnRow.appendChild(drillBtn)
    }

    header.appendChild(btnRow)
    this.panelEl.appendChild(header)

    // KPI value cards
    this.kpiDefs.forEach((def) => {
      const val = community.kpis[def.id]
      if (val === undefined) return
      const card = document.createElement('div')
      card.className = `lv-chart-card${def.id === this.activeKpi ? ' lv-active' : ''}`
      card.style.cursor = 'pointer'
      card.addEventListener('click', () => this.setActiveKpi(def.id))

      const label = document.createElement('p')
      label.className = 'lv-chart-title'
      label.textContent = def.label
      card.appendChild(label)

      const value = document.createElement('p')
      value.style.cssText = `margin:0;font-size:28px;font-weight:700;color:${this.theme.colorText};letter-spacing:-0.02em;`
      value.textContent = formatKpiValue(val, def)
      card.appendChild(value)

      this.panelEl.appendChild(card)
    })
  }

  private renderComparisonCharts(width: number): void {
    // One distribution card per KPI. Active KPI rendered first + emphasized.
    // The previous design also included a giant ranked-bar chart at the top,
    // which became unreadable for fine-grained levels (600+ bars for block
    // groups), so it's removed in favour of the more scalable distribution
    // cards. Selection still flows via map clicks.
    const level = this.activeBinding?.table.meta?.geographyLevel
    const compatible = [...this.kpiDefs.values()].filter((def) => {
      if (!level || !def.availableAtLevels || def.availableAtLevels.length === 0) return true
      return def.availableAtLevels.includes(level)
    })

    const active = compatible.find((d) => d.id === this.activeKpi)
    if (active) this.renderDistributionCard(active, width, true)
    compatible.forEach((def) => {
      if (def.id !== this.activeKpi) this.renderDistributionCard(def, width, false)
    })
  }

  /** Big ranked-bar card. Bidirectional cross-filter: clicking a bar selects. */
  private renderRankedBarCard(kpiDef: KpiDefinition, width: number): void {
    const card = document.createElement('div')
    card.className = 'lv-chart-card'

    const title = document.createElement('p')
    title.className = 'lv-chart-title'
    title.textContent = `${kpiDef.label} — all communities`
    card.appendChild(title)

    const chartEl = document.createElement('div')
    chartEl.className = 'lv-chart-container'
    card.appendChild(chartEl)
    this.panelEl.appendChild(card)

    const selectedIds = this.selection.getSnapshot().selected
    const data = [...this.communities]
      .sort((a, b) => (b.kpis[kpiDef.id] ?? 0) - (a.kpis[kpiDef.id] ?? 0))
      .map((c) => ({
        id: c.id,
        label: c.label,
        value: c.kpis[kpiDef.id] ?? 0,
        selected: selectedIds.has(c.id),
      }))

    const height = Math.max(200, data.length * 32 + 48)
    const hasSelection = selectedIds.size > 0

    const plot = Plot.plot({
      width: width - 48,
      height,
      marginLeft: 140, // wide enough for "Dakota County", "Saint Louis County", etc.
      marginRight: 16,
      marginTop: 8,
      marginBottom: 36,
      style: {
        background: 'transparent',
        color: this.theme.colorTextMuted,
        fontFamily: this.theme.fontFamily,
        fontSize: '11px',
        overflow: 'visible',
      },
      x: {
        tickSize: 0,
        tickPadding: 8,
        line: false,
        tickFormat: (d: number) => formatKpiValue(d, kpiDef),
      },
      y: { tickSize: 0 },
      marks: [
        Plot.gridX({ stroke: this.theme.colorBorder, strokeOpacity: 0.5 }),
        Plot.barX(data, {
          y: 'label',
          x: 'value',
          fill: (d: { selected: boolean }) =>
            d.selected ? this.theme.colorAccent : this.theme.colorPrimary,
          fillOpacity: (d: { selected: boolean }) =>
            hasSelection ? (d.selected ? 1 : 0.25) : 0.85,
          rx: 3,
          sort: { y: '-x' },
          tip: true,
        }),
        Plot.ruleX([0], { stroke: this.theme.colorBorder }),
      ],
    })

    chartEl.appendChild(plot)

    // Bidirectional click → selection. Plot renders one <rect> per row in
    // sorted order, so the index matches data[i].
    const rects = plot.querySelectorAll('rect[fill]')
    const dataRects = Array.from(rects).filter((r) => {
      const x = parseFloat(r.getAttribute('x') ?? '0')
      return x > 0 || r.getAttribute('width') !== '0'
    })
    if (dataRects.length === data.length) {
      dataRects.forEach((rect, i) => {
        const datum = data[i]
        ;(rect as SVGElement).style.cursor = 'pointer'
        rect.addEventListener('click', (e) => {
          e.stopPropagation()
          if (datum.selected) this.selection.clear()
          else this.selection.selectFeatures([datum.id], 'replace')
        })
      })
    }
  }

  /**
   * Compact distribution card for a non-active KPI: title, min/median/max
   * stats row, mini histogram, and (if a feature is selected) a marker line
   * at the selected feature's value. Click the card to make this KPI active.
   */
  private renderDistributionCard(def: KpiDefinition, width: number, isActive = false): void {
    const card = document.createElement('div')
    card.className = `lv-chart-card lv-distribution-card${isActive ? ' lv-active' : ''}`
    if (!isActive) {
      card.title = `Click to make "${def.label}" the active KPI`
      card.addEventListener('click', () => this.setActiveKpi(def.id))
    } else {
      card.title = `${def.label} — currently active (drives the choropleth)`
    }

    // Gather + summarize values
    const values = this.communities
      .map((c) => c.kpis[def.id])
      .filter((v): v is number => typeof v === 'number' && isFinite(v))

    const sorted = [...values].sort((a, b) => a - b)
    const min = sorted[0] ?? 0
    const max = sorted[sorted.length - 1] ?? 0
    const med = sorted[Math.floor(sorted.length / 2)] ?? 0

    // Resolve a single-select for the marker
    const selectedIds = this.selection.getSnapshot().selected
    const selectedId = selectedIds.size === 1 ? [...selectedIds][0] : null
    const selectedCommunity = selectedId
      ? this.communities.find((c) => c.id === selectedId)
      : null
    const selectedValue = selectedCommunity?.kpis[def.id]
    const selectedValid = typeof selectedValue === 'number' && isFinite(selectedValue)

    // ── Header: title + stats ──────────────────────────────────────────────
    const header = document.createElement('div')
    header.className = 'lv-distribution-header'

    const title = document.createElement('p')
    title.className = 'lv-chart-title'
    title.textContent = def.label
    header.appendChild(title)

    const stats = document.createElement('div')
    stats.className = 'lv-distribution-stats'
    stats.innerHTML = `
      <span>min <b>${formatKpiValue(min, def)}</b></span>
      <span>med <b>${formatKpiValue(med, def)}</b></span>
      <span>max <b>${formatKpiValue(max, def)}</b></span>
    `
    header.appendChild(stats)
    card.appendChild(header)

    // ── Histogram ──────────────────────────────────────────────────────────
    const chartEl = document.createElement('div')
    chartEl.className = 'lv-chart-container'

    if (values.length > 0) {
      const marks: Plot.Markish[] = [
        Plot.rectY(
          values,
          Plot.binX(
            { y: 'count' },
            { x: (v: number) => v, fill: this.theme.colorPrimary, fillOpacity: 0.55 },
          ),
        ),
        Plot.ruleY([0], { stroke: this.theme.colorBorder, strokeOpacity: 0.5 }),
      ]
      if (selectedValid) {
        marks.push(
          Plot.ruleX([selectedValue as number], {
            stroke: this.theme.colorAccent,
            strokeWidth: 2,
          }),
        )
      }

      const plot = Plot.plot({
        width: width - 48,
        height: isActive ? 130 : 78,
        marginLeft: 8,
        marginRight: 8,
        marginTop: 6,
        marginBottom: 22,
        style: {
          background: 'transparent',
          color: this.theme.colorTextMuted,
          fontFamily: this.theme.fontFamily,
          fontSize: '10px',
          overflow: 'visible',
        },
        x: {
          tickSize: 0,
          tickPadding: 6,
          line: false,
          tickFormat: (d: number) => formatKpiValue(d, def),
        },
        y: { axis: null },
        marks,
      })

      chartEl.appendChild(plot)
    }
    card.appendChild(chartEl)

    // ── Selected feature indicator ─────────────────────────────────────────
    if (selectedCommunity && selectedValid) {
      const indicator = document.createElement('p')
      indicator.className = 'lv-distribution-selected'
      indicator.innerHTML = `<b>${selectedCommunity.label}</b> · ${formatKpiValue(selectedValue as number, def)}`
      card.appendChild(indicator)
    }

    this.panelEl.appendChild(card)
  }

  private buildTooltip(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'lv-tooltip'
    el.style.opacity = '0'
    this.mapEl.appendChild(el)
    return el
  }

  private showTooltip(el: HTMLElement, point: maplibregl.Point, props: Record<string, unknown>): void {
    const kpiDef = this.kpiDefs.get(this.activeKpi)
    const label = String(props['_lv_label'] ?? props['_lv_id'] ?? '—')
    const val = props[this.activeKpi]

    el.innerHTML = `
      <div class="lv-tooltip-label">${label}</div>
      ${kpiDef ? `<div class="lv-tooltip-row"><span>${kpiDef.label}</span><span>${val !== undefined ? formatKpiValue(Number(val), kpiDef) : '—'}</span></div>` : ''}
    `

    const x = Math.min(point.x + 12, this.mapEl.clientWidth - 240)
    const y = Math.min(point.y - 8, this.mapEl.clientHeight - 80)
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    el.style.opacity = '1'
  }

  private buildResizeHandle(parent: HTMLElement): HTMLElement {
    const handle = document.createElement('div')
    handle.className = 'lv-resize-handle'

    let dragging = false
    let startX = 0
    let startRatio = this.splitRatio

    handle.addEventListener('mousedown', (e) => {
      dragging = true
      startX = e.clientX
      startRatio = this.splitRatio
      handle.classList.add('lv-dragging')
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    })

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return
      const totalW = parent.clientWidth
      const delta = (e.clientX - startX) / totalW
      this.splitRatio = Math.min(0.8, Math.max(0.2, startRatio + delta))
      this.mapEl.style.width = `${this.splitRatio * 100}%`
      handle.style.left = `${this.splitRatio * 100}%`
      this.map.resize()
    })

    document.addEventListener('mouseup', () => {
      if (!dragging) return
      dragging = false
      handle.classList.remove('lv-dragging')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      this.renderPanel()
    })

    handle.style.left = `${this.splitRatio * 100}%`
    return handle
  }

  private emit<K extends keyof LocalVisionEventMap>(event: K, payload: LocalVisionEventMap[K]): void {
    const handlers = this.listeners[event] as ((e: LocalVisionEventMap[K]) => void)[] | undefined
    handlers?.forEach((h) => h(payload))
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function formatKpiValue(value: number, def: KpiDefinition): string {
  switch (def.format) {
    case 'percent': return `${(value * 100).toFixed(1)}%`
    case 'currency': return `$${value.toLocaleString()}`
    case 'rate': return `${value.toFixed(1)}${def.unit ?? ''}`
    default: return value.toLocaleString()
  }
}

function collectCoords(geometry: CommunityRecord['geojson']['features'][0]['geometry']): number[][] {
  switch (geometry.type) {
    case 'Polygon': return geometry.coordinates.flat()
    case 'MultiPolygon': return geometry.coordinates.flat(2)
    case 'Point': return [geometry.coordinates]
    case 'LineString': return geometry.coordinates
    default: return []
  }
}

/** Close a vertex ring by repeating the first point if not already closed. */
function closeRing(points: [number, number][]): [number, number][] {
  if (points.length < 3) return points
  const [fx, fy] = points[0]
  const [lx, ly] = points[points.length - 1]
  return fx === lx && fy === ly ? points : [...points, points[0]]
}

/** Average of a point list — good enough for placing a shape's label. */
function centroid(points: [number, number][]): [number, number] {
  if (points.length === 0) return [0, 0]
  let sx = 0
  let sy = 0
  for (const [x, y] of points) {
    sx += x
    sy += y
  }
  return [sx / points.length, sy / points.length]
}

// ── Binding adapters ──────────────────────────────────────────────────────────

/**
 * Convert a DataBinding (boundaries + tabular data joined by GEOID) into the
 * CommunityRecord[] shape that OuterCityView's renderer expects internally.
 */
function bindingToCommunities(
  binding: DataBinding,
  currentTime?: string | number | null,
): CommunityRecord[] {
  // For temporal bindings, build a geoid → values index for the requested time.
  // Falls back to the most recent time if currentTime is not in the timeAxis.
  let timeIndex: Map<string, Record<string, number | null>> | null = null
  if (binding.table.timeAxis) {
    const times = binding.table.timeAxis.times
    const resolvedTime =
      currentTime != null && times.includes(currentTime)
        ? currentTime
        : times[times.length - 1]
    timeIndex = new Map()
    for (const row of binding.table.rows) {
      if (row.time === resolvedTime) timeIndex.set(row.geoid, row.values)
    }
  }

  return binding.boundaries.features.map((f) => {
    const geoid = String(f.properties?.['_lv_geoid'] ?? '')
    const label = String(f.properties?.['_lv_label'] ?? geoid)
    const kpis: Record<string, number> = {}

    if (timeIndex) {
      // Temporal: pull values from the time-filtered index
      const values = timeIndex.get(geoid)
      if (values) {
        for (const v of binding.table.variables) {
          const val = values[v.key]
          if (typeof val === 'number') kpis[v.key] = val
        }
      }
    } else {
      // Static: values were merged into feature properties at bind time
      for (const v of binding.table.variables) {
        const val = f.properties?.[v.key]
        if (typeof val === 'number') kpis[v.key] = val
      }
    }

    return {
      id: geoid,
      label,
      geojson: { type: 'FeatureCollection', features: [f] },
      kpis,
    }
  })
}

/** Derive KPI definitions from a binding's variable metadata. */
function bindingToKpiDefs(binding: DataBinding): KpiDefinition[] {
  return binding.table.variables.map((v) => ({
    id: v.key,
    label: v.label,
    format: v.format,
    unit: v.unit,
    availableAtLevels: v.availableAtLevels,
  }))
}
