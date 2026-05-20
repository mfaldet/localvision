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
import { TimeStore, type TimeState, type TimeValue } from '../state/time'
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
  private time: TimeStore
  private timeBarEl: HTMLElement
  private timePlayBtn: HTMLButtonElement
  private timeSliderEl: HTMLInputElement
  private timeLabelEl: HTMLElement
  private loadingOverlayEl: HTMLElement
  private loadingLabelEl: HTMLElement
  private loadingElapsedEl: HTMLElement
  private loadingProgressBarEl: HTMLElement
  private loadingStart: number | null = null
  private loadingTimer: ReturnType<typeof setInterval> | null = null
  /** Rolling history of recent fetch durations per level for ETA display. */
  private fetchTimings = new Map<string, number[]>()
  /** What level / label we're currently loading toward, if anything. */
  private loadingTarget: { level: string; label: string } | null = null
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
    this.time = new TimeStore()

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

    // ── Time bar (Bundle 4 — only shown for temporal bindings) ──────────────
    this.timeBarEl = document.createElement('div')
    this.timeBarEl.className = 'lv-time-bar'
    this.timeBarEl.style.display = 'none'

    this.timePlayBtn = document.createElement('button')
    this.timePlayBtn.className = 'lv-time-play'
    this.timePlayBtn.type = 'button'
    this.timePlayBtn.textContent = '⏵'
    this.timePlayBtn.title = 'Play / pause'
    this.timePlayBtn.addEventListener('click', () => this.time.toggle())

    const startLabel = document.createElement('span')
    startLabel.className = 'lv-time-range-label'

    this.timeSliderEl = document.createElement('input')
    this.timeSliderEl.type = 'range'
    this.timeSliderEl.className = 'lv-time-slider'
    this.timeSliderEl.min = '0'
    this.timeSliderEl.value = '0'
    this.timeSliderEl.addEventListener('input', () => {
      this.time.setIndex(parseInt(this.timeSliderEl.value, 10))
    })

    const endLabel = document.createElement('span')
    endLabel.className = 'lv-time-range-label'

    this.timeLabelEl = document.createElement('span')
    this.timeLabelEl.className = 'lv-time-current'

    this.timeBarEl.appendChild(this.timePlayBtn)
    this.timeBarEl.appendChild(startLabel)
    this.timeBarEl.appendChild(this.timeSliderEl)
    this.timeBarEl.appendChild(endLabel)
    this.timeBarEl.appendChild(this.timeLabelEl)
    this.root.appendChild(this.timeBarEl)

    this.time.subscribe((state) => {
      this.renderTimeBar(state, startLabel, endLabel)
      // Forward to active view (only OuterCityView supports time today)
      if (state.current != null) this.outerView?.setCurrentTime(state.current)
    })

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
    const progressTrack = document.createElement('div')
    progressTrack.className = 'lv-loading-progress-track'
    this.loadingProgressBarEl = document.createElement('div')
    this.loadingProgressBarEl.className = 'lv-loading-progress-bar'
    progressTrack.appendChild(this.loadingProgressBarEl)
    card.appendChild(spinner)
    card.appendChild(this.loadingLabelEl)
    card.appendChild(progressTrack)
    card.appendChild(this.loadingElapsedEl)
    this.loadingOverlayEl.appendChild(card)
    this.bodyEl.appendChild(this.loadingOverlayEl)

    // Drill-down store wiring: breadcrumb on every change, loading overlay
    // on the loading flag (using loadingTarget for the label + ETA).
    this.drilldown.subscribe((state) => {
      this.renderBreadcrumb(state)
      const label = this.loadingTarget?.label ?? state.current?.level.label
      const estimate = this.loadingTarget ? this.estimateTime(this.loadingTarget.level) : null
      this.updateLoadingOverlay(state.loading, label, estimate)
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
   * Time store for time-varying data. Subscribe to receive time-change
   * updates, or call `.setCurrent(time)` / `.play()` / `.pause()` to
   * navigate or animate programmatically.
   */
  get timeStore(): TimeStore {
    return this.time
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

    this.loadingTarget = { level: nextLevel, label: `${parentLabel} → ${capitalize(nextLevel)}` }
    this.drilldown.setLoading(true)
    const start = performance.now()
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
      this.syncTimeForBinding(binding)
      this.recordTiming(nextLevel, performance.now() - start)
    } catch (err) {
      console.error('[LocalVision] Drill failed:', err)
    } finally {
      this.loadingTarget = null
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
    this.time.destroy()
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

    this.loadingTarget = { level, label: `${stateLabel} ${levelLabel}` }
    this.drilldown.setLoading(true)
    const start = performance.now()
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
      this.syncTimeForBinding(binding)
      this.recordTiming(level, performance.now() - start)
    } catch (err) {
      console.error('[LocalVision] Level swap failed:', err)
    } finally {
      this.loadingTarget = null
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
      // If a time bar is active, push current time to the freshly-mounted view
      const t = this.time.currentValue()
      if (t != null) this.outerView.setCurrentTime(t)
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
    this.syncTimeForBinding(outerBinding)
  }

  /**
   * Configure the TimeStore + visibility of the time bar based on whether
   * the active binding has a timeAxis. Called whenever the active binding
   * changes (initial load, drill, level swap).
   */
  private syncTimeForBinding(binding: DataBinding): void {
    const axis = binding.table.timeAxis
    if (axis && axis.times.length >= 2) {
      this.time.setTimes([...axis.times], undefined, axis.label)
      this.timeBarEl.style.display = ''
    } else {
      this.time.setTimes([])
      this.timeBarEl.style.display = 'none'
    }
  }

  private deriveRootLabel(): string {
    const levelLabel = LEVEL_META[this.outerBoundary]?.label ?? this.outerBoundary
    return levelLabel
  }

  /**
   * Update the time bar UI from a TimeStore snapshot:
   *  - slider min/max/value
   *  - range labels at each end
   *  - current-value label
   *  - play/pause button state
   */
  private renderTimeBar(
    state: TimeState,
    startLabel: HTMLElement,
    endLabel: HTMLElement,
  ): void {
    if (state.times.length < 2) {
      this.timeBarEl.style.display = 'none'
      return
    }
    this.timeBarEl.style.display = ''

    this.timeSliderEl.min = '0'
    this.timeSliderEl.max = String(state.times.length - 1)
    this.timeSliderEl.value = String(Math.max(0, state.currentIndex))

    startLabel.textContent = String(state.times[0])
    endLabel.textContent = String(state.times[state.times.length - 1])
    this.timeLabelEl.textContent = state.current != null ? String(state.current) : ''

    this.timePlayBtn.textContent = state.playing ? '⏸' : '⏵'
    this.timePlayBtn.title = state.playing ? 'Pause' : 'Play'
  }

  /**
   * Show / hide the centered loading overlay and tick the elapsed counter.
   * When `estimateMs` is provided (rolling avg of past fetches for this level),
   * the overlay shows expected completion + a derived progress percentage.
   */
  private updateLoadingOverlay(
    loading: boolean,
    levelLabel?: string,
    estimateMs?: number | null,
  ): void {
    if (!loading) {
      this.loadingOverlayEl.style.display = 'none'
      this.loadingStart = null
      this.loadingProgressBarEl.style.width = '0%'
      if (this.loadingTimer) {
        clearInterval(this.loadingTimer)
        this.loadingTimer = null
      }
      return
    }

    this.loadingOverlayEl.style.display = ''
    this.loadingLabelEl.textContent = `Loading ${levelLabel ?? 'data'}…`
    this.loadingStart = performance.now()
    const hasEstimate = typeof estimateMs === 'number' && estimateMs > 100
    this.loadingProgressBarEl.style.display = hasEstimate ? '' : 'none'
    this.loadingElapsedEl.textContent = hasEstimate
      ? `~${(estimateMs! / 1000).toFixed(1)}s expected`
      : '0.0s elapsed'

    if (this.loadingTimer) clearInterval(this.loadingTimer)
    this.loadingTimer = setInterval(() => {
      if (this.loadingStart === null) return
      const elapsed = (performance.now() - this.loadingStart) / 1000
      if (hasEstimate) {
        const est = estimateMs! / 1000
        const remaining = Math.max(0, est - elapsed)
        // Cap at 95% so we never look "done" before we are
        const pct = Math.min(95, (elapsed / est) * 100)
        this.loadingProgressBarEl.style.width = `${pct}%`
        this.loadingElapsedEl.textContent = remaining > 0.2
          ? `${elapsed.toFixed(1)}s · ~${remaining.toFixed(1)}s remaining`
          : `${elapsed.toFixed(1)}s · finishing…`
      } else {
        this.loadingElapsedEl.textContent = `${elapsed.toFixed(1)}s elapsed`
      }
    }, 100)
  }

  /** Record a fetch duration for ETA estimates on future fetches. */
  private recordTiming(level: string, ms: number): void {
    const arr = this.fetchTimings.get(level) ?? []
    arr.push(ms)
    if (arr.length > 5) arr.shift()
    this.fetchTimings.set(level, arr)
  }

  /** Rolling-average estimate (ms) for a level, or null if no history. */
  private estimateTime(level: string): number | null {
    const arr = this.fetchTimings.get(level)
    if (!arr || arr.length === 0) return null
    return arr.reduce((a, b) => a + b, 0) / arr.length
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
