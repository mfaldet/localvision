import maplibregl from 'maplibre-gl'
import type {
  InnerCityOptions,
  KpiSeries,
  ChartConfig,
  FeatureSelectEvent,
  LocalVisionEventMap,
} from '../types'
import { resolveTheme, applyThemeToDom, type ResolvedTheme } from '../theme/tokens'
import { renderChart } from '../charts/render'

import 'maplibre-gl/dist/maplibre-gl.css'
import '../theme/styles.css'

const BOUNDARY_SOURCE = 'lv-boundary'
const BOUNDARY_FILL_LAYER = 'lv-boundary-fill'
const BOUNDARY_LINE_LAYER = 'lv-boundary-line'
const SELECTED_FILL_LAYER = 'lv-selected-fill'

export class InnerCityView {
  private root: HTMLElement
  private mapEl: HTMLElement
  private panelEl: HTMLElement
  private map: maplibregl.Map
  private theme: ResolvedTheme
  private kpis: Map<string, KpiSeries>
  private charts: ChartConfig[]
  private splitRatio: number
  private listeners: Partial<{ [K in keyof LocalVisionEventMap]: ((e: LocalVisionEventMap[K]) => void)[] }> = {}
  private selectedFeatureId: string | number | null = null
  private resizeObserver: ResizeObserver

  constructor(options: InnerCityOptions) {
    this.theme = resolveTheme(options.theme)
    this.splitRatio = options.splitRatio ?? 0.5
    this.kpis = new Map(options.kpis.map((k) => [k.id, k]))
    this.charts = options.charts ?? this.defaultCharts(options.kpis)

    // Resolve container
    this.root = typeof options.container === 'string'
      ? (document.querySelector(options.container) as HTMLElement)
      : options.container

    if (!this.root) throw new Error(`[LocalVision] Container not found: ${options.container}`)

    this.root.classList.add('lv-root')
    applyThemeToDom(this.root, this.theme)

    // Build map pane
    this.mapEl = document.createElement('div')
    this.mapEl.className = 'lv-map-pane'
    this.mapEl.style.width = `${this.splitRatio * 100}%`

    // Build chart panel
    this.panelEl = document.createElement('div')
    this.panelEl.className = 'lv-chart-pane'

    // Resize handle
    const handle = this.buildResizeHandle()

    this.root.appendChild(this.mapEl)
    this.root.appendChild(handle)
    this.root.appendChild(this.panelEl)

    // Init map
    const mapOpts = options.map ?? {}
    this.map = new maplibregl.Map({
      container: this.mapEl,
      style: mapOpts.style ?? this.theme.mapStyle,
      center: mapOpts.center ?? [0, 0],
      zoom: mapOpts.zoom ?? 10,
      bearing: mapOpts.bearing ?? 0,
      pitch: mapOpts.pitch ?? 0,
      attributionControl: true,
    })

    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')

    this.map.on('load', () => {
      this.addBoundaryLayers(options)
      this.fitToBoundary(options.boundary)
      if (options.layers) this.addCustomLayers(options)
    })

    // Render chart panel
    this.renderPanel()

    // Responsive re-render
    this.resizeObserver = new ResizeObserver(() => this.renderPanel())
    this.resizeObserver.observe(this.panelEl)
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  on<K extends keyof LocalVisionEventMap>(
    event: K,
    handler: (e: LocalVisionEventMap[K]) => void,
  ): this {
    if (!this.listeners[event]) this.listeners[event] = [] as never
    ;(this.listeners[event] as ((e: LocalVisionEventMap[K]) => void)[]).push(handler)
    return this
  }

  updateKpi(id: string, series: KpiSeries): void {
    this.kpis.set(id, series)
    this.renderPanel()
  }

  setTheme(overrides: InnerCityOptions['theme']): void {
    this.theme = resolveTheme(overrides)
    applyThemeToDom(this.root, this.theme)
    this.renderPanel()
  }

  destroy(): void {
    this.resizeObserver.disconnect()
    this.map.remove()
    this.root.innerHTML = ''
    this.root.classList.remove('lv-root')
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private defaultCharts(kpis: KpiSeries[]): ChartConfig[] {
    return kpis.slice(0, 4).map((k) => ({
      type: 'bar' as const,
      kpiId: k.id,
      title: k.label,
    }))
  }

  private addBoundaryLayers(options: InnerCityOptions): void {
    this.map.addSource(BOUNDARY_SOURCE, {
      type: 'geojson',
      data: options.boundary as GeoJSON.FeatureCollection,
      generateId: true,
    })

    this.map.addLayer({
      id: BOUNDARY_FILL_LAYER,
      type: 'fill',
      source: BOUNDARY_SOURCE,
      paint: {
        'fill-color': this.theme.colorPrimary,
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.18, 0.08],
      },
    })

    this.map.addLayer({
      id: SELECTED_FILL_LAYER,
      type: 'fill',
      source: BOUNDARY_SOURCE,
      paint: {
        'fill-color': this.theme.colorAccent,
        'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.28, 0],
      },
    })

    this.map.addLayer({
      id: BOUNDARY_LINE_LAYER,
      type: 'line',
      source: BOUNDARY_SOURCE,
      paint: {
        'line-color': this.theme.colorPrimary,
        'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 1.5],
        'line-opacity': 0.9,
      },
    })

    // Hover interaction
    let hoveredId: string | number | null = null

    this.map.on('mousemove', BOUNDARY_FILL_LAYER, (e) => {
      if (!e.features?.length) return
      if (hoveredId !== null) {
        this.map.setFeatureState({ source: BOUNDARY_SOURCE, id: hoveredId }, { hover: false })
      }
      hoveredId = e.features[0].id ?? null
      if (hoveredId !== null) {
        this.map.setFeatureState({ source: BOUNDARY_SOURCE, id: hoveredId }, { hover: true })
      }
      this.map.getCanvas().style.cursor = 'pointer'
    })

    this.map.on('mouseleave', BOUNDARY_FILL_LAYER, () => {
      if (hoveredId !== null) {
        this.map.setFeatureState({ source: BOUNDARY_SOURCE, id: hoveredId }, { hover: false })
      }
      hoveredId = null
      this.map.getCanvas().style.cursor = ''
    })

    // Click / select interaction
    this.map.on('click', BOUNDARY_FILL_LAYER, (e) => {
      if (!e.features?.length) return
      const feat = e.features[0]
      const fid = feat.id ?? null

      if (this.selectedFeatureId !== null) {
        this.map.setFeatureState(
          { source: BOUNDARY_SOURCE, id: this.selectedFeatureId },
          { selected: false },
        )
      }

      this.selectedFeatureId = fid
      if (fid !== null) {
        this.map.setFeatureState({ source: BOUNDARY_SOURCE, id: fid }, { selected: true })
      }

      this.emit('featureSelect', {
        featureId: fid,
        properties: (feat.properties as Record<string, unknown>) ?? {},
        lngLat: [e.lngLat.lng, e.lngLat.lat],
      })
    })
  }

  private addCustomLayers(options: InnerCityOptions): void {
    options.layers?.forEach((layerCfg) => {
      const sourceId = `lv-custom-${layerCfg.id}`
      this.map.addSource(sourceId, {
        type: 'geojson',
        data: typeof layerCfg.source === 'string'
          ? layerCfg.source
          : (layerCfg.source as GeoJSON.FeatureCollection),
      })
      this.map.addLayer({
        id: layerCfg.id,
        type: layerCfg.type,
        source: sourceId,
        paint: (layerCfg.paint ?? {}) as maplibregl.LayerSpecification['paint'],
        layout: (layerCfg.layout ?? {}) as maplibregl.LayerSpecification['layout'],
      } as maplibregl.LayerSpecification)
    })
  }

  private fitToBoundary(geojson: InnerCityOptions['boundary']): void {
    const bounds = new maplibregl.LngLatBounds()
    geojson.features.forEach((feat) => {
      collectCoords(feat.geometry).forEach(([lng, lat]) => bounds.extend([lng, lat]))
    })
    if (!bounds.isEmpty()) {
      this.map.fitBounds(bounds, { padding: 48, duration: 800 })
    }
  }

  private renderPanel(): void {
    this.panelEl.innerHTML = ''
    const panelWidth = this.panelEl.clientWidth || 400

    this.charts.forEach((cfg) => {
      const series = this.kpis.get(cfg.kpiId)
      if (!series) return

      const card = document.createElement('div')
      card.className = 'lv-chart-card'

      const title = document.createElement('p')
      title.className = 'lv-chart-title'
      title.textContent = cfg.title ?? series.label
      card.appendChild(title)

      const chartContainer = document.createElement('div')
      chartContainer.className = 'lv-chart-container'
      card.appendChild(chartContainer)

      this.panelEl.appendChild(card)

      renderChart(cfg, series, chartContainer, this.theme, panelWidth - 48, cfg.height ?? 160)
    })
  }

  private buildResizeHandle(): HTMLElement {
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
      const totalW = this.root.clientWidth
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

    // Position handle at initial split
    handle.style.left = `${this.splitRatio * 100}%`

    return handle
  }

  private emit<K extends keyof LocalVisionEventMap>(event: K, payload: LocalVisionEventMap[K]): void {
    const handlers = this.listeners[event] as ((e: LocalVisionEventMap[K]) => void)[] | undefined
    handlers?.forEach((h) => h(payload))
  }
}

// ── Utility ────────────────────────────────────────────────────────────────────

function collectCoords(geometry: InnerCityOptions['boundary']['features'][0]['geometry']): number[][] {
  switch (geometry.type) {
    case 'Polygon': return geometry.coordinates.flat()
    case 'MultiPolygon': return geometry.coordinates.flat(2)
    case 'Point': return [geometry.coordinates]
    case 'LineString': return geometry.coordinates
    default: return []
  }
}
