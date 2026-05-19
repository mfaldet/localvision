import type {
  LocalVisionAppOptions,
  ViewMode,
  LocalVisionEventMap,
  BoundaryChangeEvent,
  GeoJsonFeatureCollection,
} from '../types'
import type { OuterLevel, InnerLevel } from '../geo/levels'
import { LEVEL_META } from '../geo/levels'
import { BoundaryLoader } from '../geo/loader'
import { SelectionStore } from '../state/selection'
import { resolveTheme, applyThemeToDom } from '../theme/tokens'
import { InnerCityView } from './InnerCityView'
import { OuterCityView } from './OuterCityView'

import '../theme/styles.css'

// ─── Level option lists (ordered for readability) ─────────────────────────────

const OUTER_LEVELS: OuterLevel[] = ['state', 'county', 'place', 'cousub']

const INNER_LEVELS: InnerLevel[] = [
  'tract', 'bg', 'place', 'cousub', 'zcta',
  'cd', 'unsd', 'elsd', 'scsd', 'sldl', 'sldu',
]

// ─── LocalVisionApp ───────────────────────────────────────────────────────────

export class LocalVisionApp {
  private root: HTMLElement
  private headerEl: HTMLElement
  private dividerEl: HTMLElement
  private kpiSlotEl: HTMLElement
  private boundarySelectEl: HTMLSelectElement
  private bodyEl: HTMLElement

  private activeView: ViewMode
  private innerBoundary: InnerLevel
  private outerBoundary: OuterLevel

  private innerView: InnerCityView | null = null
  private outerView: OuterCityView | null = null
  private options: LocalVisionAppOptions
  private geoLoader: BoundaryLoader
  private selection: SelectionStore
  private listeners: Partial<{
    [K in keyof LocalVisionEventMap]: ((e: LocalVisionEventMap[K]) => void)[]
  }> = {}

  constructor(options: LocalVisionAppOptions) {
    this.options = options
    this.activeView = options.defaultView ?? 'outer'
    this.innerBoundary = options.defaultInnerBoundary ?? 'tract'
    this.outerBoundary = options.defaultOuterBoundary ?? 'county'
    this.geoLoader = new BoundaryLoader({ sessionCache: true })
    this.selection = new SelectionStore()

    const theme = resolveTheme(options.theme)

    this.root = typeof options.container === 'string'
      ? (document.querySelector(options.container) as HTMLElement)
      : options.container

    if (!this.root) throw new Error(`[LocalVision] Container not found: ${options.container}`)

    this.root.classList.add('lv-root')
    this.root.style.flexDirection = 'column'
    applyThemeToDom(this.root, theme)

    // ── Header ───────────────────────────────────────────────────────────────
    this.headerEl = document.createElement('div')
    this.headerEl.className = 'lv-app-header'

    // 1. View toggle (far left)
    this.headerEl.appendChild(this.buildToggle())

    // 2. Boundary dropdown (immediately right of toggle)
    this.boundarySelectEl = this.buildBoundarySelect()
    this.headerEl.appendChild(this.boundarySelectEl)

    // 3. Divider — separates the toggle+boundary group from KPI pills
    this.dividerEl = document.createElement('div')
    this.dividerEl.className = 'lv-header-divider'
    this.headerEl.appendChild(this.dividerEl)

    // 4. KPI slot — OuterCityView renders its pills here
    this.kpiSlotEl = document.createElement('div')
    this.kpiSlotEl.className = 'lv-kpi-selector'
    this.headerEl.appendChild(this.kpiSlotEl)

    this.root.appendChild(this.headerEl)

    // ── Body ─────────────────────────────────────────────────────────────────
    this.bodyEl = document.createElement('div')
    this.bodyEl.className = 'lv-app-body'
    this.root.appendChild(this.bodyEl)

    // Render initial state
    this.syncHeaderForView(this.activeView)
    this.mountView(this.activeView)
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  switchTo(view: ViewMode): void {
    if (view === this.activeView) return
    // Save the current boundary selection before switching
    this.saveCurrentBoundary()
    this.destroyActiveView()
    this.activeView = view
    this.updateToggleUI()
    this.syncHeaderForView(view)
    this.mountView(view)
  }

  /** Read the currently selected boundary level. */
  get boundary(): OuterLevel | InnerLevel {
    return this.boundarySelectEl.value as OuterLevel | InnerLevel
  }

  /**
   * Shared selection store. Subscribe to receive cross-component selection
   * updates from any view, or mutate to drive selection from external code.
   */
  get selectionStore(): SelectionStore {
    return this.selection
  }

  on<K extends keyof LocalVisionEventMap>(
    event: K,
    handler: (e: LocalVisionEventMap[K]) => void,
  ): this {
    if (!this.listeners[event]) this.listeners[event] = [] as never
    ;(this.listeners[event] as ((e: LocalVisionEventMap[K]) => void)[]).push(handler)
    this.innerView?.on(event, handler)
    this.outerView?.on(event, handler)
    return this
  }

  destroy(): void {
    this.destroyActiveView()
    this.root.innerHTML = ''
    this.root.classList.remove('lv-root')
  }

  // ── Private — header wiring ──────────────────────────────────────────────────

  /**
   * Swap boundary dropdown options and restore the saved selection for this view.
   * Also show/hide the KPI-pill divider (only relevant in outer mode).
   */
  private syncHeaderForView(view: ViewMode): void {
    const levels = view === 'inner' ? INNER_LEVELS : OUTER_LEVELS
    const savedValue = view === 'inner' ? this.innerBoundary : this.outerBoundary

    // Rebuild <option> list
    this.boundarySelectEl.innerHTML = ''
    levels.forEach((level) => {
      const opt = document.createElement('option')
      opt.value = level
      opt.textContent = LEVEL_META[level].label
      this.boundarySelectEl.appendChild(opt)
    })

    // Restore saved selection (fall back to first option if somehow invalid)
    this.boundarySelectEl.value = savedValue
    if (this.boundarySelectEl.value !== savedValue) {
      this.boundarySelectEl.selectedIndex = 0
    }

    // Divider + KPI slot only shown in outer mode (they're for KPI pills)
    const showKpiArea = view === 'outer'
    this.dividerEl.style.display = showKpiArea ? '' : 'none'
    this.kpiSlotEl.style.display = showKpiArea ? '' : 'none'
  }

  private saveCurrentBoundary(): void {
    const current = this.boundarySelectEl.value
    if (this.activeView === 'inner') {
      this.innerBoundary = current as InnerLevel
    } else {
      this.outerBoundary = current as OuterLevel
    }
  }

  private buildBoundarySelect(): HTMLSelectElement {
    const sel = document.createElement('select')
    sel.className = 'lv-boundary-select'
    sel.title = 'Boundary level'

    sel.addEventListener('change', () => {
      const boundary = sel.value as OuterLevel | InnerLevel
      if (this.activeView === 'inner') {
        this.innerBoundary = boundary as InnerLevel
      } else {
        this.outerBoundary = boundary as OuterLevel
      }
      this.emit('boundaryChange', { boundary, view: this.activeView })
      void this.fetchAndApplyBoundary(boundary, this.activeView)
    })

    return sel
  }

  private buildToggle(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'lv-view-toggle'

    const modes: { id: ViewMode; label: string }[] = [
      { id: 'inner', label: 'Inner City' },
      { id: 'outer', label: 'Outer City' },
    ]

    modes.forEach(({ id, label }) => {
      const btn = document.createElement('button')
      btn.className = 'lv-view-toggle-btn'
      btn.classList.toggle('lv-active', id === this.activeView)
      btn.dataset['view'] = id
      btn.textContent = label
      btn.addEventListener('click', () => this.switchTo(id))
      wrap.appendChild(btn)
    })

    return wrap
  }

  private updateToggleUI(): void {
    this.headerEl.querySelectorAll<HTMLButtonElement>('.lv-view-toggle-btn').forEach((btn) => {
      btn.classList.toggle('lv-active', btn.dataset['view'] === this.activeView)
    })
  }

  // ── Private — view lifecycle ──────────────────────────────────────────────────

  private mountView(view: ViewMode): void {
    this.bodyEl.innerHTML = ''
    this.kpiSlotEl.innerHTML = ''

    const container = document.createElement('div')
    container.style.cssText = 'width:100%;height:100%;'
    this.bodyEl.appendChild(container)

    if (view === 'inner') {
      this.innerView = new InnerCityView({
        ...this.options.inner,
        container,
        theme: this.options.theme,
      })
      this.forwardListeners(this.innerView)
    } else {
      this.outerView = new OuterCityView({
        ...this.options.outer,
        container,
        theme: this.options.theme,
        headerEl: this.kpiSlotEl,
        selection: this.selection,
      })
      this.forwardListeners(this.outerView)
    }

    // Auto-load boundary overlay if a context is configured
    if (this.options.boundaryContext) {
      const level = view === 'inner' ? this.innerBoundary : this.outerBoundary
      void this.fetchAndApplyBoundary(level, view)
    }
  }

  private destroyActiveView(): void {
    this.innerView?.destroy()
    this.innerView = null
    this.outerView?.destroy()
    this.outerView = null
  }

  private forwardListeners(view: InnerCityView | OuterCityView): void {
    const keys = Object.keys(this.listeners) as (keyof LocalVisionEventMap)[]
    keys.forEach((k) => {
      // boundaryChange is owned by LocalVisionApp, not the child views
      if (k === 'boundaryChange') return
      const handlers = this.listeners[k] as ((e: never) => void)[] | undefined
      handlers?.forEach((h) => view.on(k, h as never))
    })
  }

  private async fetchAndApplyBoundary(
    level: OuterLevel | InnerLevel,
    view: ViewMode,
  ): Promise<void> {
    const ctx = this.options.boundaryContext
    if (!ctx) return

    this.boundarySelectEl.disabled = true
    this.boundarySelectEl.style.opacity = '0.5'

    let geojson: GeoJsonFeatureCollection
    try {
      if (view === 'outer') {
        geojson = await this.geoLoader.outerLevel(level as OuterLevel, ctx.stateFips)
      } else {
        geojson = await this.geoLoader.innerLevel(level as InnerLevel, ctx.stateFips, ctx.countyFips)
      }
      this.innerView?.setBoundaryLayer(geojson)
      this.outerView?.setBoundaryLayer(geojson)
    } catch (err) {
      console.error('[LocalVision] Boundary fetch failed:', err)
    } finally {
      this.boundarySelectEl.disabled = false
      this.boundarySelectEl.style.opacity = ''
    }
  }

  private emit<K extends keyof LocalVisionEventMap>(event: K, payload: LocalVisionEventMap[K]): void {
    const handlers = this.listeners[event] as ((e: LocalVisionEventMap[K]) => void)[] | undefined
    handlers?.forEach((h) => h(payload))
  }
}
