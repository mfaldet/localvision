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
import { getStateMeta, resolveStateFips } from '../geo/fips'
import { SelectionStore } from '../state/selection'
import {
  DrilldownStore,
  parseGeoId,
  type DrilldownLevel,
  type DrilldownState,
  type DrillTarget,
} from '../state/drilldown'
import type { DataBinding } from '../data/types'
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
  private drilldown: DrilldownStore
  private breadcrumbEl: HTMLElement
  private loadingOverlayEl: HTMLElement
  private loadingLabelEl: HTMLElement
  private loadingElapsedEl: HTMLElement
  private loadingStart: number | null = null
  private loadingTimer: ReturnType<typeof setInterval> | null = null
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
    this.drilldown = new DrilldownStore()

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

    // ── Breadcrumb (drill-down navigation) ──────────────────────────────────
    this.breadcrumbEl = document.createElement('div')
    this.breadcrumbEl.className = 'lv-breadcrumb'
    this.breadcrumbEl.style.display = 'none' // hidden until a drillProvider is configured
    this.root.appendChild(this.breadcrumbEl)

    // ── Body ─────────────────────────────────────────────────────────────────
    this.bodyEl = document.createElement('div')
    this.bodyEl.className = 'lv-app-body'
    this.bodyEl.style.position = 'relative' // anchor for loading overlay
    this.root.appendChild(this.bodyEl)

    // Loading overlay (mounted but hidden until a fetch is in-flight)
    this.loadingOverlayEl = document.createElement('div')
    this.loadingOverlayEl.className = 'lv-loading-overlay'
    this.loadingOverlayEl.style.display = 'none'
    const card = document.createElement('div')
    card.className = 'lv-loading-card'
    const spinner = document.createElement('div')
    spinner.className = 'lv-loading-spinner'
    this.loadingLabelEl = document.createElement('div')
    this.loadingLabelEl.className = 'lv-loading-label'
    this.loadingLabelEl.textContent = 'Loading…'
    this.loadingElapsedEl = document.createElement('div')
    this.loadingElapsedEl.className = 'lv-loading-elapsed'
    card.appendChild(spinner)
    card.appendChild(this.loadingLabelEl)
    card.appendChild(this.loadingElapsedEl)
    this.loadingOverlayEl.appendChild(card)
    this.bodyEl.appendChild(this.loadingOverlayEl)

    // Drill-down store wiring: breadcrumb on every change, loading overlay
    // on the loading flag specifically.
    this.drilldown.subscribe((state) => {
      this.renderBreadcrumb(state)
      this.updateLoadingOverlay(state.loading, state.current?.level.label)
    })

    // Render initial state
    this.syncHeaderForView(this.activeView)
    this.mountView(this.activeView)
    this.initializeDrilldownRoot()
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

  /**
   * Drill-down stack store. Subscribe to receive navigation updates, or call
   * `.popTo(depth)` to navigate programmatically.
   */
  get drilldownStore(): DrilldownStore {
    return this.drilldown
  }

  /**
   * Drill into a feature. Resolves the next level via `options.drillProvider`
   * and updates the active OuterCityView's binding. No-op if no provider is
   * configured, no binding is loaded, or the provider returns null.
   */
  async drillInto(parentGeoid: string, parentLabel: string, parentProperties: Record<string, unknown>): Promise<void> {
    if (!this.options.drillProvider) return
    const current = this.drilldown.current()
    if (!current) return

    const nextLevel = nextDrillLevel(current.level.level)
    if (!nextLevel) return

    const parsed = parseGeoId(parentGeoid)
    const target: DrillTarget = {
      level: nextLevel,
      parent: { geoid: parentGeoid, label: parentLabel, properties: parentProperties },
      context: {
        stateFips: parsed.stateFips ?? current.level.context.stateFips,
        countyFips: parsed.countyFips ?? current.level.context.countyFips,
        tractFips: parsed.tractFips ?? current.level.context.tractFips,
      },
    }

    this.drilldown.setLoading(true)
    try {
      const binding = await this.options.drillProvider(target)
      if (!binding) return

      const newLevel: DrilldownLevel = {
        id: `${nextLevel}:${parentGeoid}`,
        label: `${parentLabel} → ${capitalize(nextLevel)}`,
        level: nextLevel,
        context: target.context,
        parent: { geoid: parentGeoid, label: parentLabel },
      }
      this.drilldown.push(newLevel, binding)
      this.outerView?.updateBinding(binding)
    } catch (err) {
      console.error('[LocalVision] Drill failed:', err)
    } finally {
      this.drilldown.setLoading(false)
    }
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
    if (this.loadingTimer) clearInterval(this.loadingTimer)
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

      // Full data swap when a drillProvider is configured + outer view active.
      // Otherwise fall back to the legacy overlay-only fetch.
      if (this.options.drillProvider && this.activeView === 'outer') {
        void this.swapToLevel(boundary as OuterLevel)
      } else {
        void this.fetchAndApplyBoundary(boundary, this.activeView)
      }
    })

    return sel
  }

  /**
   * Replace the active level entirely. Used when the boundary dropdown
   * changes and the app has a drillProvider configured: we don't just paint
   * outlines on top of stale data, we swap the choropleth + data + charts
   * to the new level.
   *
   * Resets the drill stack to a new root at this level. Any previously-cached
   * deeper levels are discarded (different parent → different data).
   */
  private async swapToLevel(level: OuterLevel): Promise<void> {
    const provider = this.options.drillProvider
    const ctx = this.options.boundaryContext
    if (!provider || !ctx) return

    const stateFips = resolveStateFips(ctx.stateFips)
    const stateMeta = getStateMeta(stateFips)
    const stateLabel = stateMeta?.name ?? stateFips
    const levelLabel = LEVEL_META[level]?.label ?? level

    this.drilldown.setLoading(true)
    try {
      const binding = await provider({
        level,
        parent: { geoid: stateFips, label: stateLabel, properties: {} },
        context: { stateFips },
      })
      if (!binding) return

      const newRoot: DrilldownLevel = {
        id: `root:${level}`,
        label: `${stateLabel} ${levelLabel}`,
        level,
        context: { stateFips },
      }
      this.drilldown.setRoot(newRoot, binding)
      this.outerView?.updateBinding(binding)
    } catch (err) {
      console.error('[LocalVision] Level swap failed:', err)
    } finally {
      this.drilldown.setLoading(false)
    }
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
        onDrillRequest: this.options.drillProvider
          ? (c) => this.drillInto(c.id, c.label, c.properties)
          : undefined,
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

  // ── Private — drill-down ────────────────────────────────────────────────────

  /**
   * Seed the drill-down store with a root entry derived from the OuterCityView
   * configuration. Only runs when a drillProvider is set; without one, the
   * breadcrumb stays hidden.
   */
  private initializeDrilldownRoot(): void {
    if (!this.options.drillProvider) return
    const outerBinding = (this.options.outer as { binding?: DataBinding }).binding
    if (!outerBinding) return

    const root: DrilldownLevel =
      this.options.rootDrilldownLevel ?? {
        id: 'root',
        label: this.deriveRootLabel(),
        level: this.outerBoundary,
        context: { stateFips: this.options.boundaryContext?.stateFips },
      }
    this.drilldown.setRoot(root, outerBinding)
    this.breadcrumbEl.style.display = ''
  }

  private deriveRootLabel(): string {
    const levelLabel = LEVEL_META[this.outerBoundary]?.label ?? this.outerBoundary
    return levelLabel
  }

  /**
   * Show / hide the centered loading overlay and tick the elapsed-time
   * counter every 100ms while a fetch is in flight.
   */
  private updateLoadingOverlay(loading: boolean, levelLabel?: string): void {
    if (loading) {
      this.loadingOverlayEl.style.display = ''
      this.loadingLabelEl.textContent = `Loading ${levelLabel ?? 'data'}…`
      this.loadingStart = performance.now()
      this.loadingElapsedEl.textContent = '0.0s'
      if (this.loadingTimer) clearInterval(this.loadingTimer)
      this.loadingTimer = setInterval(() => {
        if (this.loadingStart === null) return
        const elapsed = (performance.now() - this.loadingStart) / 1000
        this.loadingElapsedEl.textContent = `${elapsed.toFixed(1)}s elapsed`
      }, 100)
    } else {
      this.loadingOverlayEl.style.display = 'none'
      this.loadingStart = null
      if (this.loadingTimer) {
        clearInterval(this.loadingTimer)
        this.loadingTimer = null
      }
    }
  }

  private renderBreadcrumb(state: DrilldownState): void {
    if (!this.options.drillProvider) return
    this.breadcrumbEl.innerHTML = ''

    state.stack.forEach((entry, i) => {
      const isLast = i === state.stack.length - 1
      const item = document.createElement('button')
      item.className = `lv-breadcrumb-item${isLast ? ' lv-current' : ''}`
      item.textContent = entry.level.label
      item.disabled = isLast
      item.addEventListener('click', () => {
        if (isLast) return
        const target = this.drilldown.popTo(i + 1)
        if (target) this.outerView?.updateBinding(target.binding)
      })
      this.breadcrumbEl.appendChild(item)

      if (!isLast) {
        const sep = document.createElement('span')
        sep.className = 'lv-breadcrumb-sep'
        sep.textContent = '›'
        this.breadcrumbEl.appendChild(sep)
      }
    })

    if (state.loading) {
      const loading = document.createElement('span')
      loading.className = 'lv-breadcrumb-loading'
      loading.textContent = 'loading…'
      this.breadcrumbEl.appendChild(loading)
    }
  }
}

// ─── Drill-down helpers ──────────────────────────────────────────────────────

/**
 * Canonical drill paths for outer-city analysis. State → county → tract → bg.
 * Returns null when there's no deeper level (block group is the floor).
 */
function nextDrillLevel(
  from: OuterLevel | InnerLevel,
): OuterLevel | InnerLevel | null {
  switch (from) {
    case 'state':  return 'county'
    case 'county': return 'tract'
    case 'tract':  return 'bg'
    default:       return null
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
