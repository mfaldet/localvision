import maplibregl from 'maplibre-gl'
import * as Plot from '@observablehq/plot'
import type {
  OuterCityOptions,
  CommunityRecord,
  KpiDefinition,
  ChartConfig,
  LocalVisionEventMap,
} from '../types'
import { resolveTheme, applyThemeToDom, type ResolvedTheme } from '../theme/tokens'

import 'maplibre-gl/dist/maplibre-gl.css'
import '../theme/styles.css'

const COMMUNITIES_SOURCE = 'lv-communities'
const CHOROPLETH_FILL = 'lv-choropleth-fill'
const CHOROPLETH_LINE = 'lv-choropleth-line'
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
  private selectedId: string | null = null
  private listeners: Partial<{ [K in keyof LocalVisionEventMap]: ((e: LocalVisionEventMap[K]) => void)[] }> = {}
  private resizeObserver: ResizeObserver

  constructor(options: OuterCityOptions) {
    this.theme = resolveTheme(options.theme)
    this.splitRatio = options.splitRatio ?? 0.5
    this.communities = options.communities
    this.kpiDefs = new Map(options.kpiDefs.map((k) => [k.id, k]))
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
    this.mapEl.style.width = `${this.splitRatio * 100}%`

    const handle = this.buildResizeHandle(body)

    this.panelEl = document.createElement('div')
    this.panelEl.className = 'lv-chart-pane'

    body.appendChild(this.mapEl)
    body.appendChild(handle)
    body.appendChild(this.panelEl)

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
    })

    this.renderKpiSelector()
    this.renderPanel()

    this.resizeObserver = new ResizeObserver(() => this.renderPanel())
    this.resizeObserver.observe(this.panelEl)
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

  destroy(): void {
    this.resizeObserver.disconnect()
    this.map.remove()
    this.root.innerHTML = ''
    this.root.classList.remove('lv-root')
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private buildMergedGeoJson() {
    return {
      type: 'FeatureCollection',
      features: this.communities.flatMap((c) =>
        c.geojson.features.map((f) => ({
          ...f,
          properties: { ...f.properties, _lv_id: c.id, _lv_label: c.label, ...c.kpis },
        })),
      ),
    }
  }

  private addCommunityLayers(): void {
    this.map.addSource(COMMUNITIES_SOURCE, {
      type: 'geojson',
      data: this.buildMergedGeoJson() as GeoJSON.FeatureCollection,
      generateId: true,
    })

    // Choropleth fill — color driven by active KPI
    this.map.addLayer({
      id: CHOROPLETH_FILL,
      type: 'fill',
      source: COMMUNITIES_SOURCE,
      paint: {
        'fill-color': this.buildColorExpression(),
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.85, 0.65],
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
        'line-color': this.theme.colorBackground,
        'line-width': 1,
        'line-opacity': 0.8,
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
      const fid = e.features[0].id ?? null

      if (this.selectedId !== null) {
        const prev = this.communities.find((c) => c.id === this.selectedId)
        if (prev) {
          prev.geojson.features.forEach((_, i) => {
            this.map.setFeatureState({ source: COMMUNITIES_SOURCE, id: i }, { selected: false })
          })
        }
      }

      this.selectedId = cid
      if (fid !== null) {
        this.map.setFeatureState({ source: COMMUNITIES_SOURCE, id: fid }, { selected: true })
      }

      this.emit('featureSelect', {
        featureId: cid,
        properties: props,
        lngLat: [e.lngLat.lng, e.lngLat.lat],
      })

      this.renderPanel()
    })
  }

  private buildColorExpression(): maplibregl.ExpressionSpecification {
    const kpiDef = this.kpiDefs.get(this.activeKpi)
    const palette = kpiDef?.colorScale ?? [
      '#1e3a5f', '#2563eb', '#60a5fa', '#bfdbfe', '#ecfdf5', '#6ee7b7', '#10b981', '#065f46',
    ]
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
    this.kpiDefs.forEach((def) => {
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
    const selected = this.communities.find((c) => c.id === this.selectedId)

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

    const backBtn = document.createElement('button')
    backBtn.style.cssText = `margin-top:12px;background:none;border:1px solid ${this.theme.colorBorder};color:${this.theme.colorTextMuted};padding:4px 10px;border-radius:4px;font-size:11px;cursor:pointer;`
    backBtn.textContent = '← All communities'
    backBtn.addEventListener('click', () => {
      this.selectedId = null
      this.renderPanel()
    })
    header.appendChild(backBtn)
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
    const kpiDef = this.kpiDefs.get(this.activeKpi)
    if (!kpiDef) return

    // Ranked bar chart of all communities for active KPI
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

    const data = [...this.communities]
      .sort((a, b) => (b.kpis[this.activeKpi] ?? 0) - (a.kpis[this.activeKpi] ?? 0))
      .map((c) => ({ label: c.label, value: c.kpis[this.activeKpi] ?? 0 }))

    const height = Math.max(200, data.length * 32 + 48)

    const plot = Plot.plot({
      width: width - 48,
      height,
      marginLeft: 100,
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
          fill: this.theme.colorPrimary,
          fillOpacity: 0.85,
          rx: 3,
          sort: { y: '-x' },
          tip: true,
        }),
        Plot.ruleX([0], { stroke: this.theme.colorBorder }),
      ],
    })

    chartEl.appendChild(plot)
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
