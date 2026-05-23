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
  private selection: SelectionStore
  private unsubscribeSelection: () => void = () => {}
  private communityFids = new Map<string, number[]>()
  private onDrillRequest?: (c: { id: string; label: string; properties: Record<string, unknown> }) => void
  private activeBinding: DataBinding | null = null
  private currentTime: string | number | null = null
  private drillButtonLabel?: string
  private listeners: Partial<{ [K in keyof LocalVisionEventMap]: ((e: LocalVisionEventMap[K]) => void)[] }> = {}
  private resizeObserver: ResizeObserver

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

    this.currentTime = time
    this.communities = bindingToCommunities(this.activeBinding, this.currentTime)

    if (this.map.isStyleLoaded()) {
      const source = this.map.getSource(COMMUNITIES_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined
      if (source) {
        source.setData(this.buildMergedGeoJson() as GeoJSON.FeatureCollection)
      }
      this.updateChoropleth()
    }
    // No fitToAllCommunities — boundaries haven't changed, only values
    this.renderPanel()
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

  destroy(): void {
    this.unsubscribeSelection()
    this.resizeObserver.disconnect()
    this.map.remove()
    this.root.innerHTML = ''
    this.root.classList.remove('lv-root')
  }

  // ── Private ─────────────────────────────────────────────────────────────────

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
    const activeKpi = this.kpiDefs.get(this.activeKpi)
    if (!activeKpi) return

    // 1. Big ranked bar chart for the active KPI.
    this.renderRankedBarCard(activeKpi, width)

    // 2. Compact distribution card for every other KPI.
    this.kpiDefs.forEach((def) => {
      if (def.id !== this.activeKpi) {
        this.renderDistributionCard(def, width)
      }
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
  private renderDistributionCard(def: KpiDefinition, width: number): void {
    const card = document.createElement('div')
    card.className = 'lv-chart-card lv-distribution-card'
    card.title = `Click to make "${def.label}" the active KPI`
    card.addEventListener('click', () => this.setActiveKpi(def.id))

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
        height: 78,
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
