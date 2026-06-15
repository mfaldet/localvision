import type {
  LocalVisionAppOptions,
  ViewMode,
  LocalVisionEventMap,
  BoundaryChangeEvent,
  GeoJsonFeatureCollection,
} from '../types'
import type { OuterLevel, InnerLevel } from '../geo/levels'
import { LEVEL_META } from '../geo/levels'
import { BoundaryLoader, type PlaceIndexEntry } from '../geo/loader'
import { getStateMeta, resolveStateFips } from '../geo/fips'
import { bbox, bboxCenter, findFeatureContaining } from '../geo/spatial'
import { LAYER_PRESETS } from '../layers/presets'
import { fetchOverpassGeoJson } from '../layers/overpass'
import { exportMapPng, exportAppPng } from '../export/png'
import { readUrlState, writeUrlState, type UrlState } from '../export/url-state'
import type { GeoJsonFeature } from '../types'
import { SelectionStore } from '../state/selection'
import {
  DrilldownStore,
  parseGeoId,
  type DrilldownLevel,
  type DrilldownState,
  type DrillTarget,
} from '../state/drilldown'
import { TimeStore, type TimeState } from '../state/time'
import type { DataBinding } from '../data/types'
import { resolveTheme, applyThemeToDom } from '../theme/tokens'
import { InnerCityView } from './InnerCityView'
import { OuterCityView } from './OuterCityView'

import '../theme/styles.css'

// ─── Level option lists (ordered for readability) ─────────────────────────────

// 'state' deliberately omitted — when a city is selected we stay scoped
// to that city's state. Nation-wide state comparison is out of scope and
// also trips the TIGERweb WAF on large geometry payloads.
const OUTER_LEVELS: OuterLevel[] = ['county', 'place', 'cousub']

// Levels supported by the city-first demo's drillProvider AND with ACS
// support in the data layer. School / legislative / congressional districts
// + ZCTAs are valid Census levels but need ACS-level wiring on the data
// side before they can be exposed here — picking them today would return
// null from the provider and silently no-op.
const INNER_LEVELS: InnerLevel[] = ['tract', 'bg', 'place', 'cousub']

// ─── LocalVisionApp ───────────────────────────────────────────────────────────

export class LocalVisionApp {
  private root: HTMLElement
  private headerEl: HTMLElement
  private dividerEl: HTMLElement
  private kpiSlotEl: HTMLElement
  private boundarySelectEl: HTMLSelectElement
  private settingsBtn!: HTMLButtonElement
  private settingsPanelEl!: HTMLElement
  private compareBtn!: HTMLButtonElement
  private exportBtn!: HTMLButtonElement
  private bodyEl: HTMLElement
  /** When true, the body shows two side-by-side OuterCityViews. */
  private compareEnabled = false
  /** Right-side view in compare mode (left side is this.outerView). */
  private outerViewCompare: OuterCityView | null = null
  /** Active KPI for the right map in compare mode. */
  private compareActiveKpi: string | null = null
  /** Teardown hook for pan/zoom sync listeners. */
  private compareSyncTeardown: (() => void) | null = null

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
  /** City search UI + state */
  private citySearchEl: HTMLInputElement
  private citySearchDropdownEl: HTMLElement
  private cityToggleContainerEl: HTMLElement
  private emptyStateEl: HTMLElement
  private selectedCity: PlaceIndexEntry | null = null
  private selectedCityFeature: GeoJsonFeature | null = null
  /** Resolved via point-in-polygon when the city is selected. Used by Inner. */
  private selectedCityCountyFips: string | null = null
  private placesIndex: PlaceIndexEntry[] = []
  /** Views that have loaded data (and therefore appear in the toggle). */
  private loadedViews = new Set<ViewMode>()
  /** Cached bindings per view — used when (re-)mounting after a switch. */
  private viewBindings = new Map<ViewMode, import('../data/types').DataBinding>()
  /** Dedicated container for the active view's DOM (so body can also host overlays). */
  private viewContainerEl: HTMLElement | null = null
  private listeners: Partial<{
    [K in keyof LocalVisionEventMap]: ((e: LocalVisionEventMap[K]) => void)[]
  }> = {}

  constructor(options: LocalVisionAppOptions) {
    this.options = options
    // Default to Inner City — the primary "see your city's dynamics" view
    this.activeView = options.defaultView ?? 'inner'
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

    // 1. City search (far left) — entry point for the app
    const { wrapEl, inputEl, dropdownEl } = this.buildCitySearch()
    this.citySearchEl = inputEl
    this.citySearchDropdownEl = dropdownEl
    this.headerEl.appendChild(wrapEl)

    // 2. View toggle container (dynamic — populated as views load)
    this.cityToggleContainerEl = document.createElement('div')
    this.cityToggleContainerEl.className = 'lv-view-toggle'
    this.cityToggleContainerEl.style.display = 'none'
    this.headerEl.appendChild(this.cityToggleContainerEl)

    // 3. Boundary dropdown
    this.boundarySelectEl = this.buildBoundarySelect()
    this.boundarySelectEl.style.display = 'none'
    this.headerEl.appendChild(this.boundarySelectEl)

    // 4. Divider — separates the toggle+boundary group from KPI pills
    this.dividerEl = document.createElement('div')
    this.dividerEl.className = 'lv-header-divider'
    this.dividerEl.style.display = 'none'
    this.headerEl.appendChild(this.dividerEl)

    // 5. KPI slot — OuterCityView renders its pills here
    this.kpiSlotEl = document.createElement('div')
    this.kpiSlotEl.className = 'lv-kpi-selector'
    this.kpiSlotEl.style.display = 'none'
    this.headerEl.appendChild(this.kpiSlotEl)

    // 6. Compare toggle — splits the body into two side-by-side maps
    this.compareBtn = document.createElement('button')
    this.compareBtn.className = 'lv-compare-btn'
    this.compareBtn.title = 'Toggle side-by-side comparison'
    this.compareBtn.setAttribute('aria-label', 'Toggle side-by-side comparison')
    this.compareBtn.setAttribute('aria-pressed', 'false')
    this.compareBtn.textContent = '⇆'
    this.compareBtn.style.display = 'none' // shown once a city is loaded
    this.compareBtn.addEventListener('click', () => this.toggleCompareMode())
    this.headerEl.appendChild(this.compareBtn)

    // 6.5. Export — downloads the current view as a PNG
    this.exportBtn = document.createElement('button')
    this.exportBtn.className = 'lv-export-btn'
    this.exportBtn.title = 'Export view as PNG'
    this.exportBtn.setAttribute('aria-label', 'Export view as PNG')
    this.exportBtn.textContent = '⤓'
    this.exportBtn.style.display = 'none'
    this.exportBtn.addEventListener('click', () => void this.handleExportClick())
    this.headerEl.appendChild(this.exportBtn)

    // 7. Display-settings gear (far right) — toggles the settings panel
    this.settingsBtn = document.createElement('button')
    this.settingsBtn.className = 'lv-settings-btn'
    this.settingsBtn.title = 'Display settings'
    this.settingsBtn.setAttribute('aria-label', 'Open display settings panel')
    this.settingsBtn.setAttribute('aria-expanded', 'false')
    this.settingsBtn.setAttribute('aria-controls', 'lv-settings-panel')
    this.settingsBtn.textContent = '⚙'
    this.settingsBtn.style.display = 'none' // shown once a city is loaded
    this.settingsBtn.addEventListener('click', () => this.toggleSettingsPanel())
    this.headerEl.appendChild(this.settingsBtn)

    this.root.appendChild(this.headerEl)

    // Settings panel — absolute-positioned popover anchored to header right
    this.settingsPanelEl = this.buildSettingsPanel()
    this.settingsPanelEl.id = 'lv-settings-panel'
    this.settingsPanelEl.setAttribute('role', 'region')
    this.settingsPanelEl.setAttribute('aria-label', 'Display settings')
    this.settingsPanelEl.style.display = 'none'
    this.root.appendChild(this.settingsPanelEl)

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
    this.loadingOverlayEl.setAttribute('role', 'status')
    this.loadingOverlayEl.setAttribute('aria-live', 'polite')
    this.loadingOverlayEl.setAttribute('aria-atomic', 'true')
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
    // Hint about cache behaviour — block group and tract levels can take
    // 30-60s on first load because of the Census paginated geometry fetch.
    const hint = document.createElement('div')
    hint.className = 'lv-loading-hint'
    hint.textContent = 'First load can take 30–60s · cached after'
    card.appendChild(spinner)
    card.appendChild(this.loadingLabelEl)
    card.appendChild(progressTrack)
    card.appendChild(this.loadingElapsedEl)
    card.appendChild(hint)
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

    // Empty-state placeholder for the body — shown until a city is picked.
    this.emptyStateEl = document.createElement('div')
    this.emptyStateEl.className = 'lv-empty-state'
    this.emptyStateEl.innerHTML = `
      <div class="lv-empty-state-card">
        <h2>Pick a city to begin</h2>
        <p>Type the name of any US incorporated place in the search box at the top-left.</p>
      </div>
    `
    this.bodyEl.appendChild(this.emptyStateEl)

    // City-first mode is engaged when a drillProvider is configured but no
    // initial outer.binding was supplied. Back-compat path: if outer.binding
    // IS provided, mount immediately like before.
    const hasInitialBinding = !!(this.options.outer as { binding?: unknown }).binding
    if (hasInitialBinding) {
      this.emptyStateEl.style.display = 'none'
      this.cityToggleContainerEl.style.display = ''
      this.boundarySelectEl.style.display = ''
      this.loadedViews.add(this.activeView)
      this.renderViewToggle()
      this.syncHeaderForView(this.activeView)
      this.mountView(this.activeView)
      this.initializeDrilldownRoot()
    } else {
      // City-first: prefetch the nation-wide places index in the background
      // so the autocomplete is ready by the time the user starts typing.
      this.citySearchEl.placeholder = 'Loading US cities…'
      void this.geoLoader
        .placesIndex()
        .then((entries) => {
          this.placesIndex = entries
          this.citySearchEl.placeholder = 'Pick a city (e.g. Rosemount, MN)'
          this.citySearchEl.disabled = false
          // Once the index is ready, try to restore from URL hash. The
          // index makes city-by-geoid lookup instant; no need to refetch.
          void this.restoreFromUrlIfAny()
        })
        .catch((err) => {
          console.error('[LocalVision] Failed to load US places index:', err)
          this.citySearchEl.placeholder = 'City search unavailable'
        })
    }
  }

  /**
   * On boot, if the URL hash carries a city + view state, restore it.
   * The places index is required to map a GEOID back to a PlaceIndexEntry,
   * so this is called after the index resolves.
   */
  private async restoreFromUrlIfAny(): Promise<void> {
    const state = readUrlState()
    if (!state.city) return
    const entry = this.placesIndex.find((p) => p.geoid === state.city)
    if (!entry) {
      console.warn(`[LocalVision] URL state references unknown city geoid: ${state.city}`)
      return
    }
    // Apply pre-selection state so loadView picks them up
    if (state.view) this.activeView = state.view
    if (state.level) {
      if (state.view === 'outer') this.outerBoundary = state.level as OuterLevel
      else this.innerBoundary = state.level as InnerLevel
    }
    await this.selectCity(entry)
    // After select: optionally toggle compare mode, set KPIs, set time
    if (state.compare && !this.compareEnabled) this.toggleCompareMode()
    if (state.kpi) this.outerView?.setActiveKpi?.(state.kpi)
    if (state.time && this.time.getSnapshot().times.length > 0) {
      const t = state.time as string
      // Try numeric coerce first since temporal data is usually years
      const n = Number(t)
      this.time.setCurrent(isFinite(n) ? n : t)
    }
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

      // City-first mode (a city is selected): reload the active view with the
      // new boundary level. loadView respects the city context (state +
      // containing county) so inner views stay scoped to the city's tracts /
      // block groups rather than going state-wide.
      if (this.selectedCity && this.options.drillProvider) {
        void this.loadView(this.activeView)
        return
      }
      // Legacy mode: pre-city-first state-rooted outer view, drillProvider set
      if (this.options.drillProvider && this.activeView === 'outer') {
        void this.swapToLevel(boundary as OuterLevel)
        return
      }
      // No drillProvider — fall back to legacy overlay-only fetch
      void this.fetchAndApplyBoundary(boundary, this.activeView)
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

  /**
   * Render the view toggle from the current `loadedViews` set. A view that
   * isn't loaded yet appears as an "+ Outer/Inner City" affordance instead
   * of a toggle button — clicking it triggers its first data fetch and
   * activates it. Order is fixed: Outer first, then Inner.
   */
  private renderViewToggle(): void {
    this.cityToggleContainerEl.innerHTML = ''

    const modes: { id: ViewMode; label: string }[] = [
      { id: 'inner', label: 'Inner City' },
      { id: 'outer', label: 'Outer City' },
    ]

    for (const { id, label } of modes) {
      const loaded = this.loadedViews.has(id)
      const btn = document.createElement('button')
      btn.dataset['view'] = id

      if (loaded) {
        btn.className = 'lv-view-toggle-btn'
        btn.classList.toggle('lv-active', id === this.activeView)
        btn.textContent = label
        btn.addEventListener('click', () => this.switchTo(id))
      } else {
        btn.className = 'lv-view-toggle-btn lv-view-toggle-load'
        btn.textContent = `+ ${label}`
        btn.title = `Load ${label} data`
        btn.addEventListener('click', () => this.loadView(id))
      }
      this.cityToggleContainerEl.appendChild(btn)
    }
  }

  private updateToggleUI(): void {
    this.cityToggleContainerEl.querySelectorAll<HTMLButtonElement>('.lv-view-toggle-btn').forEach((btn) => {
      btn.classList.toggle('lv-active', btn.dataset['view'] === this.activeView)
    })
  }

  // ── Private — city search ─────────────────────────────────────────────────

  /** Build the city search input + dropdown UI. */
  private buildCitySearch(): {
    wrapEl: HTMLElement
    inputEl: HTMLInputElement
    dropdownEl: HTMLElement
  } {
    const wrap = document.createElement('div')
    wrap.className = 'lv-city-search'

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'lv-city-search-input'
    input.placeholder = 'Loading US cities…'
    input.disabled = true
    input.autocomplete = 'off'
    input.setAttribute('role', 'combobox')
    input.setAttribute('aria-label', 'Search for a US city')
    input.setAttribute('aria-autocomplete', 'list')
    input.setAttribute('aria-expanded', 'false')
    input.setAttribute('aria-controls', 'lv-city-search-dropdown')

    const dropdown = document.createElement('div')
    dropdown.className = 'lv-city-search-dropdown'
    dropdown.id = 'lv-city-search-dropdown'
    dropdown.setAttribute('role', 'listbox')
    dropdown.setAttribute('aria-label', 'Matching cities')
    dropdown.style.display = 'none'

    wrap.appendChild(input)
    wrap.appendChild(dropdown)

    input.addEventListener('input', () => this.renderCityMatches(input.value, dropdown))
    input.addEventListener('focus', () => {
      // If the input is showing the currently-selected city's displayName,
      // clear it so the user can start a fresh search. Without this, the
      // input value ("Rosemount, MN") matches nothing in the index (which
      // keys by short name) and the dropdown shows "No matches".
      if (this.selectedCity && input.value === this.selectedCity.displayName) {
        input.value = ''
      }
      if (input.value.trim().length > 0) this.renderCityMatches(input.value, dropdown)
    })
    input.addEventListener('blur', () => {
      // Delay so click on dropdown registers first. Also restore the
      // selected-city name if the user cleared and didn't pick a new one.
      setTimeout(() => {
        dropdown.style.display = 'none'
        input.setAttribute('aria-expanded', 'false')
        if (input.value.trim() === '' && this.selectedCity) {
          input.value = this.selectedCity.displayName
        }
      }, 150)
    })

    return { wrapEl: wrap, inputEl: input, dropdownEl: dropdown }
  }

  private renderCityMatches(query: string, dropdown: HTMLElement): void {
    // Normalize: strip trailing ", ST" abbreviation and any LSAD descriptor.
    // The index stores short names ("Rosemount") so a literal "rosemount, mn"
    // query would never match without this normalization step.
    const q = normalizeCityQuery(query)
    dropdown.innerHTML = ''
    if (q.length < 2 || this.placesIndex.length === 0) {
      dropdown.style.display = 'none'
      this.citySearchEl.setAttribute('aria-expanded', 'false')
      return
    }

    // Optional state filter from the trailing ", ST" — narrows when user
    // types "rosemount, mn" so MN entries are prioritized.
    const stateFilter = extractStateAbbr(query)

    // Score: name startsWith > name includes; cap at 25 results
    const startsWith: PlaceIndexEntry[] = []
    const includes: PlaceIndexEntry[] = []
    for (const p of this.placesIndex) {
      if (stateFilter && p.stateAbbr.toLowerCase() !== stateFilter) continue
      const nameLower = p.name.toLowerCase()
      if (nameLower.startsWith(q)) startsWith.push(p)
      else if (nameLower.includes(q)) includes.push(p)
      if (startsWith.length >= 25) break
    }
    const matches = [...startsWith, ...includes].slice(0, 25)

    if (matches.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'lv-city-search-empty'
      empty.textContent = 'No matches.'
      dropdown.appendChild(empty)
    } else {
      matches.forEach((p) => {
        const opt = document.createElement('button')
        opt.className = 'lv-city-search-option'
        opt.type = 'button'
        opt.setAttribute('role', 'option')
        opt.setAttribute('aria-label', `${p.name}, ${p.stateAbbr}`)
        opt.innerHTML = `<strong>${p.name}</strong><span>${p.stateAbbr}</span>`
        opt.addEventListener('mousedown', (e) => {
          e.preventDefault() // prevent input blur before click
          void this.selectCity(p)
        })
        dropdown.appendChild(opt)
      })
    }
    dropdown.style.display = ''
    this.citySearchEl.setAttribute('aria-expanded', 'true')
  }

  /**
   * Handler for picking a city from the autocomplete. Fetches the city's
   * polygon, then triggers the initial Outer City load.
   */
  private async selectCity(city: PlaceIndexEntry): Promise<void> {
    console.log('[LocalVision] selectCity:', city.displayName, city.stateFips, city.geoid)

    this.selectedCity = city
    this.selectedCityFeature = null
    this.selectedCityCountyFips = null
    this.viewBindings.clear()
    this.citySearchEl.value = city.displayName
    this.citySearchDropdownEl.style.display = 'none'

    // Hide empty state, reveal controls
    this.emptyStateEl.style.display = 'none'
    this.cityToggleContainerEl.style.display = ''
    this.boundarySelectEl.style.display = ''
    this.settingsBtn.style.display = ''
    this.compareBtn.style.display = ''
    this.exportBtn.style.display = ''

    // Reset state for the new city
    this.loadedViews.clear()
    this.activeView = 'inner'
    this.outerBoundary = this.options.defaultOuterBoundary ?? 'county'
    this.innerBoundary = this.options.defaultInnerBoundary ?? 'tract'

    // Show the loading overlay IMMEDIATELY, before any await. This is a
    // belt-and-suspenders direct call — bypasses the drilldown subscription
    // chain so the user gets feedback even if other handlers misbehave.
    this.loadingTarget = { level: 'state', label: city.displayName }
    this.updateLoadingOverlay(true, city.displayName, null)
    this.drilldown.setLoading(true)
    const tStart = performance.now()
    let errored = false
    try {
      // City polygon: pull places-of-state, find by GEOID
      const placesFc = await this.geoLoader.places(city.stateFips)
      const cityFeature =
        placesFc.features.find((f) => String(f.properties?.['GEOID'] ?? '') === city.geoid) ?? null
      this.selectedCityFeature = cityFeature as GeoJsonFeature | null

      // Resolve containing county via point-in-polygon (bbox-center → counties).
      // Used as the parent context when Inner view loads, so tract / bg fetches
      // are scoped to one county instead of the whole state. Best-effort —
      // failures fall through to state-wide inner fetches.
      this.selectedCityCountyFips = await this.resolveContainingCountyFips(
        city.stateFips,
        this.selectedCityFeature,
      )

      // Load Inner City first (default view) — shows city's containing
      // county's tracts. Outer City lazy-loads when the user toggles to it.
      console.log('[LocalVision] selectCity → loadView(inner)')
      await this.loadView('inner')
      console.log('[LocalVision] selectCity → loadView done in', Math.round(performance.now() - tStart), 'ms')
      this.recordTiming('state', performance.now() - tStart)

      // Replay any persisted-active map-layer presets for the new city's
      // bbox. Layer rows in the settings panel reflect persisted state
      // already; we just need to actually fetch & add the layers here.
      void this.replayPersistedLayers()

      // Write the new selection into the URL hash so the link is shareable
      this.syncUrlState()
    } catch (err) {
      errored = true
      console.error('[LocalVision] City selection failed:', err)
      this.showErrorOverlay(`Error loading ${city.displayName}`, err)
    } finally {
      this.loadingTarget = null
      this.drilldown.setLoading(false)
      // Only hide the overlay on success. On error the showErrorOverlay
      // call above keeps it visible with the error text + click-to-dismiss.
      if (!errored) this.updateLoadingOverlay(false)
    }
  }

  /** Sticky error overlay with click-to-dismiss. */
  private showErrorOverlay(label: string, err: unknown): void {
    this.loadingOverlayEl.style.display = ''
    this.loadingOverlayEl.classList.add('lv-loading-overlay-error')
    this.loadingLabelEl.textContent = label
    this.loadingElapsedEl.textContent = err instanceof Error ? err.message : String(err)
    // Stop the elapsed-timer ticker if it's still running
    if (this.loadingTimer) {
      clearInterval(this.loadingTimer)
      this.loadingTimer = null
    }
    // Click anywhere on the overlay to dismiss
    const dismiss = () => {
      this.loadingOverlayEl.removeEventListener('click', dismiss)
      this.loadingOverlayEl.classList.remove('lv-loading-overlay-error')
      this.updateLoadingOverlay(false)
    }
    this.loadingOverlayEl.addEventListener('click', dismiss)
  }

  /**
   * Find the county containing the city via point-in-polygon over the
   * state's county boundaries (cached after first call). Returns the 3-digit
   * county FIPS, or null if no containment match (very rare — usually means
   * a city polygon error or a city that straddles a county boundary).
   */
  private async resolveContainingCountyFips(
    stateFips: string,
    cityFeature: GeoJsonFeature | null,
  ): Promise<string | null> {
    if (!cityFeature) return null
    try {
      const counties = await this.geoLoader.counties(stateFips)
      const center = bboxCenter(cityFeature.geometry)
      const containing = findFeatureContaining(
        center,
        counties.features as unknown as GeoJsonFeature[],
      )
      const countyFips = containing?.properties?.['COUNTY']
      return typeof countyFips === 'string' ? countyFips : null
    } catch (err) {
      console.warn('[LocalVision] Could not resolve containing county:', err)
      return null
    }
  }

  /**
   * Load (or reload) a view for the currently selected city. The drillProvider
   * does the actual fetching; we then mount the view if needed and push it
   * into loadedViews so the toggle gets a proper button for it.
   */
  private async loadView(view: ViewMode): Promise<void> {
    if (!this.options.drillProvider || !this.selectedCity) return
    const city = this.selectedCity
    const level = view === 'outer' ? this.outerBoundary : this.innerBoundary
    // Inner views narrow to the city's containing county (resolved via
    // point-in-polygon at selection time) so tract / bg fetches are one
    // county's worth instead of the whole state. Outer views stay state-
    // scoped — county filtering would defeat their comparison purpose.
    const context: { stateFips: string; countyFips?: string } = { stateFips: city.stateFips }
    if (view === 'inner' && this.selectedCityCountyFips) {
      context.countyFips = this.selectedCityCountyFips
    }

    this.loadingTarget = {
      level,
      label: `${city.displayName} — ${LEVEL_META[level]?.label ?? level}`,
    }
    this.drilldown.setLoading(true)
    const start = performance.now()
    try {
      const binding = await this.options.drillProvider({
        level,
        parent: { geoid: city.geoid, label: city.displayName, properties: {} },
        context,
      })
      if (!binding) return

      // Cache binding so re-mounts (after view switch) reuse it
      this.viewBindings.set(view, binding)

      // Activate this view
      this.activeView = view
      this.loadedViews.add(view)
      this.renderViewToggle()
      this.syncHeaderForView(view)
      this.mountView(view)

      // Update drilldown root for this view
      const newRoot: DrilldownLevel = {
        id: `root:${view}:${level}`,
        label: `${city.displayName} ${LEVEL_META[level]?.label ?? level}`,
        level,
        context,
        parent: { geoid: city.geoid, label: city.displayName },
      }
      this.drilldown.setRoot(newRoot, binding)
      this.breadcrumbEl.style.display = ''
      this.syncTimeForBinding(binding)

      // Apply city focus overlay (mountView already does this on construction;
      // call again here in case data finished loading after style-load).
      if (this.selectedCityFeature) {
        this.outerView?.setCityFocus(this.selectedCityFeature)
      }

      this.recordTiming(level, performance.now() - start)
    } catch (err) {
      console.error(`[LocalVision] Failed to load ${view} view:`, err)
      // Re-throw so the caller (e.g. selectCity) can show the error in the
      // overlay. Previously this catch swallowed everything, which is why
      // mountView / OuterCityView construction failures looked like "load
      // finished, nothing rendered" — the load was actually broken.
      throw err
    } finally {
      this.loadingTarget = null
      this.drilldown.setLoading(false)
    }
  }

  // ── Private — view lifecycle ──────────────────────────────────────────────────

  private mountView(view: ViewMode): void {
    this.kpiSlotEl.innerHTML = ''
    this.destroyActiveView()

    // Create / reuse a view container so the loading overlay (also a child
    // of bodyEl) doesn't get wiped on every mount.
    if (this.viewContainerEl) {
      this.viewContainerEl.innerHTML = ''
    } else {
      this.viewContainerEl = document.createElement('div')
      this.viewContainerEl.className = 'lv-view-container'
      this.viewContainerEl.style.cssText = 'width:100%;height:100%;'
      this.bodyEl.appendChild(this.viewContainerEl)
    }
    const container = this.viewContainerEl

    const cityFirst = !!this.selectedCity
    const cachedBinding = this.viewBindings.get(view)
    const optionsBinding = (this.options.outer as { binding?: import('../data/types').DataBinding }).binding

    // City-first: both views use OuterCityView (Inner is just a finer scope).
    // Legacy: respect options.inner / options.outer separately as before.
    if (!cityFirst && view === 'inner' && this.options.inner) {
      this.innerView = new InnerCityView({
        ...this.options.inner,
        container,
        theme: this.options.theme,
      })
      if (this.selectedCityFeature) this.innerView.setCityFocus(this.selectedCityFeature)
      this.forwardListeners(this.innerView)
    } else if (this.compareEnabled && cityFirst) {
      // Compare mode: split body into two side-by-side OuterCityViews.
      container.style.display = 'flex'
      const leftBox = document.createElement('div')
      leftBox.className = 'lv-compare-pane lv-compare-left'
      const rightBox = document.createElement('div')
      rightBox.className = 'lv-compare-pane lv-compare-right'
      container.appendChild(leftBox)
      container.appendChild(rightBox)

      const persisted = this.loadPersistedStyle()
      const binding = cachedBinding ?? optionsBinding
      this.outerView = new OuterCityView({
        ...this.options.outer,
        binding,
        container: leftBox,
        theme: this.options.theme,
        headerEl: this.kpiSlotEl, // left view owns the shared header slot
        selection: this.selection,
        mapOnly: true,
        onDrillRequest: this.options.drillProvider
          ? (c) => this.drillInto(c.id, c.label, c.properties)
          : undefined,
      })
      // Pick + apply a different starting KPI for the right map so the
      // comparison is visually meaningful from frame one.
      const primary = this.outerView.getMap() ? this.options.outer.activeKpi : 'median_household_income'
      if (!this.compareActiveKpi && binding) {
        this.compareActiveKpi = this.pickCompareKpi(binding, primary)
      }
      this.outerViewCompare = new OuterCityView({
        ...this.options.outer,
        binding,
        container: rightBox,
        theme: this.options.theme,
        headerEl: undefined, // right view renders its own KPI bar inside its container
        selection: this.selection,
        mapOnly: true,
        activeKpi: this.compareActiveKpi ?? primary,
      })

      const t = this.time.currentValue()
      if (t != null) {
        this.outerView.setCurrentTime(t)
        this.outerViewCompare.setCurrentTime(t)
      }
      if (this.selectedCityFeature) {
        this.outerView.setCityFocus(this.selectedCityFeature)
        this.outerViewCompare.setCityFocus(this.selectedCityFeature)
      }
      if (persisted) {
        this.outerView.setStyle(persisted)
        this.outerViewCompare.setStyle(persisted)
      }
      this.forwardListeners(this.outerView)

      // Sync pan / zoom both ways
      this.compareSyncTeardown?.()
      this.compareSyncTeardown = this.wireCompareSync(this.outerView, this.outerViewCompare)
    } else {
      this.outerView = new OuterCityView({
        ...this.options.outer,
        binding: cachedBinding ?? optionsBinding,
        container,
        theme: this.options.theme,
        headerEl: this.kpiSlotEl,
        selection: this.selection,
        onDrillRequest: this.options.drillProvider
          ? (c) => this.drillInto(c.id, c.label, c.properties)
          : undefined,
      })
      const t = this.time.currentValue()
      if (t != null) this.outerView.setCurrentTime(t)
      if (this.selectedCityFeature) this.outerView.setCityFocus(this.selectedCityFeature)
      // Replay any persisted style settings into the freshly-mounted view
      // so the user's choices survive view switches AND page reloads.
      const persisted = this.loadPersistedStyle()
      if (persisted) this.outerView.setStyle(persisted)
      this.forwardListeners(this.outerView)
    }

    // Auto-load boundary overlay only in legacy mode with a static context.
    if (!cityFirst && this.options.boundaryContext) {
      const level = view === 'inner' ? this.innerBoundary : this.outerBoundary
      void this.fetchAndApplyBoundary(level, view)
    }

    // Reveal header controls + kpi slot if outer mode
    this.kpiSlotEl.style.display = view === 'outer' ? '' : 'none'
    this.dividerEl.style.display = view === 'outer' ? '' : 'none'
  }

  private destroyActiveView(): void {
    this.compareSyncTeardown?.()
    this.compareSyncTeardown = null
    this.innerView?.destroy()
    this.innerView = null
    this.outerView?.destroy()
    this.outerView = null
    this.outerViewCompare?.destroy()
    this.outerViewCompare = null
    // viewContainerEl reused — reset its display so it doesn't keep the
    // compare-mode flex layout when we re-mount in single-view mode.
    if (this.viewContainerEl) this.viewContainerEl.style.display = ''
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
      // If the overlay is showing an error, leave it alone. Without this
      // guard, a subsequent drilldown.setLoading(false) fires the
      // subscription which calls us with loading=false, wiping the error
      // text before the user can read it.
      if (this.loadingOverlayEl.classList.contains('lv-loading-overlay-error')) {
        return
      }
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

  /** Read persisted style settings from localStorage. */
  private loadPersistedStyle(): Partial<ChoroplethStyleConfig> | null {
    if (typeof localStorage === 'undefined') return null
    try {
      const raw = localStorage.getItem(LocalVisionApp.STYLE_STORAGE_KEY)
      return raw ? (JSON.parse(raw) as Partial<ChoroplethStyleConfig>) : null
    } catch {
      return null
    }
  }

  /** Merge + write persisted style settings. */
  private persistStyle(partial: Partial<ChoroplethStyleConfig>): void {
    if (typeof localStorage === 'undefined') return
    try {
      const existing = this.loadPersistedStyle() ?? {}
      const merged = { ...existing, ...partial }
      localStorage.setItem(LocalVisionApp.STYLE_STORAGE_KEY, JSON.stringify(merged))
    } catch {
      /* quota or disabled — silently skip */
    }
  }

  /** setStyle on the active view AND write to localStorage. */
  private applyAndPersistStyle(partial: Partial<ChoroplethStyleConfig>): void {
    this.outerView?.setStyle(partial)
    this.persistStyle(partial)
  }

  // ── Custom map layer presets ────────────────────────────────────────────────

  private static LAYERS_STORAGE_KEY = 'lv_custom_layers_v1'

  /** Persistent state for each preset: enabled? opacity (0..1)? */
  private loadPersistedLayers(): Record<string, { active: boolean; opacity: number }> {
    if (typeof localStorage === 'undefined') return {}
    try {
      const raw = localStorage.getItem(LocalVisionApp.LAYERS_STORAGE_KEY)
      return raw ? (JSON.parse(raw) as Record<string, { active: boolean; opacity: number }>) : {}
    } catch {
      return {}
    }
  }

  private persistLayer(id: string, partial: Partial<{ active: boolean; opacity: number }>): void {
    if (typeof localStorage === 'undefined') return
    try {
      const existing = this.loadPersistedLayers()
      const cur = existing[id] ?? { active: false, opacity: 1 }
      existing[id] = { ...cur, ...partial }
      localStorage.setItem(LocalVisionApp.LAYERS_STORAGE_KEY, JSON.stringify(existing))
    } catch {
      /* quota or disabled — skip */
    }
  }

  /**
   * After a city is selected, walk persisted layer state and re-activate
   * each previously-on preset for the new city's bbox. Layer-row UI
   * already reflects the persisted state when the panel is built, so we
   * just need to actually fetch + add the layers here.
   */
  private async replayPersistedLayers(): Promise<void> {
    const layers = this.loadPersistedLayers()
    for (const [id, state] of Object.entries(layers)) {
      if (!state.active) continue
      // Find the row's status element so we can show the loading state
      const cb = document.getElementById(`lv-layer-${id}`) as HTMLInputElement | null
      const status = cb?.parentElement?.querySelector('.lv-layer-status') as HTMLElement | null
      if (cb) cb.checked = true
      if (status) {
        status.textContent = 'loading…'
        // eslint-disable-next-line no-await-in-loop -- sequential keeps Overpass happy
        await this.activateLayerPreset(id, status)
        this.outerView?.setCustomLayerOpacity(id, state.opacity)
      }
    }
  }

  /**
   * Fetch the preset's OSM data via Overpass for the current city's bbox
   * and add it to the active view. Reentrant: if the layer is already
   * present, just flips its visibility back to 'visible'. Status messages
   * surface to the row indicator so the user knows what's happening.
   */
  private async activateLayerPreset(id: string, status: HTMLElement): Promise<void> {
    const preset = LAYER_PRESETS[id]
    if (!preset || !this.outerView) return

    // If the layer is already on the map, just toggle it back visible
    // — Overpass results are spatially indexed to the city, and bbox
    // hasn't changed, so re-fetching would be wasteful.
    try {
      this.outerView.setCustomLayerVisibility(id, true)
      const persistedLayers = this.loadPersistedLayers()
      // If we have a record AND the layer source actually exists on the
      // map, the visibility flip above suffices.
      if (persistedLayers[id] && persistedLayers[id].active) {
        // No-op — we just toggled it back on
      }
    } catch {
      /* layer not yet added — fall through to fetch */
    }

    // Compute the bbox to query Overpass for. Use the selected city's
    // polygon bbox + a small margin (10%) so layers extend a bit past
    // the city's boundary. Falls back to the visible map bounds.
    const cityFeature = this.selectedCityFeature
    let queryBbox: [number, number, number, number]
    if (cityFeature) {
      const [w, s, e, n] = bbox(cityFeature.geometry)
      const margin = 0.1
      const dx = (e - w) * margin
      const dy = (n - s) * margin
      queryBbox = [s - dy, w - dx, n + dy, e + dx]
    } else {
      // No selected city — Overpass needs SOME bbox; refuse rather than
      // hammer the API with a continent-sized query.
      status.textContent = 'pick a city first'
      this.persistLayer(id, { active: false })
      return
    }

    try {
      const startedAt = performance.now()
      const fc = await fetchOverpassGeoJson({
        bbox: queryBbox,
        query: preset.overpassQuery,
      })
      const elapsedMs = Math.round(performance.now() - startedAt)

      this.outerView.addCustomLayer({
        id: preset.id,
        type: preset.type,
        source: fc,
        paint: preset.paint,
      })
      status.textContent = `${fc.features.length} · ${(elapsedMs / 1000).toFixed(1)}s`
      this.persistLayer(id, { active: true })
    } catch (err) {
      console.error(`[LocalVision] layer ${id} fetch failed:`, err)
      status.textContent = 'failed'
      this.persistLayer(id, { active: false })
    }
  }

  /**
   * Wire up the clip-area "Draw" button. Two modes:
   *   1. Not drawing — clicking starts a new drawing session. Hint shows.
   *      On completion (polygon closed): apply to view + reveal Clear.
   *      On cancel (Esc / too few points): just reset the button.
   *   2. Drawing — clicking aborts the in-flight drawing.
   */
  private handleClipDrawClick(
    drawBtn: HTMLButtonElement,
    clearBtn: HTMLButtonElement,
    hintEl: HTMLElement,
  ): void {
    if (!this.outerView) return
    if (drawBtn.dataset['drawing'] === 'true') {
      this.outerView.cancelClipDrawing()
      drawBtn.dataset['drawing'] = 'false'
      drawBtn.textContent = 'Draw clip area'
      hintEl.style.display = 'none'
      return
    }
    drawBtn.dataset['drawing'] = 'true'
    drawBtn.textContent = 'Cancel'
    hintEl.style.display = ''
    // Auto-collapse the panel so the user can see the map
    this.toggleSettingsPanel()
    this.outerView.startClipDrawing((feature) => {
      drawBtn.dataset['drawing'] = 'false'
      drawBtn.textContent = 'Draw clip area'
      hintEl.style.display = 'none'
      if (feature && this.outerView) {
        this.outerView.setClipPolygon(feature)
        clearBtn.style.display = ''
      }
    })
  }

  private toggleSettingsPanel(): void {
    const open = this.settingsPanelEl.style.display !== 'none'
    this.settingsPanelEl.style.display = open ? 'none' : ''
    this.settingsBtn.classList.toggle('lv-active', !open)
    this.settingsBtn.setAttribute('aria-expanded', open ? 'false' : 'true')
  }

  // ── Comparison mode ─────────────────────────────────────────────────────────

  /**
   * Switch the body between "single map + chart panel" and "two
   * side-by-side maps". On enter, mounts a second OuterCityView with the
   * same binding but its own KPI selector. On exit, tears it down and
   * re-mounts the normal single-view layout.
   */
  private toggleCompareMode(): void {
    if (!this.selectedCity || !this.outerView) return
    this.compareEnabled = !this.compareEnabled
    this.compareBtn.classList.toggle('lv-active', this.compareEnabled)
    this.compareBtn.setAttribute('aria-pressed', this.compareEnabled ? 'true' : 'false')
    // Re-mount the active view in the new layout
    this.mountView(this.activeView)
    this.syncUrlState()
  }

  // ── Export & URL state ──────────────────────────────────────────────────────

  /**
   * PNG export — captures whatever's most useful for the user given the
   * current mode. Single-view: full app screenshot (map + chart panel +
   * header). Compare-mode: just the map area, since the side-by-side
   * arrangement is the artefact being shared.
   */
  async handleExportClick(): Promise<void> {
    if (!this.outerView) return
    this.exportBtn.disabled = true
    this.exportBtn.textContent = '…'
    try {
      const city = this.selectedCity?.displayName?.replace(/[^a-z0-9]+/gi, '-').toLowerCase() ?? 'view'
      const stamp = new Date().toISOString().slice(0, 10)
      const filename = `localvision-${city}-${stamp}.png`
      if (this.compareEnabled) {
        await exportMapPng(this.outerView.getMap(), filename)
      } else {
        await exportAppPng(this.root, filename)
      }
    } catch (err) {
      console.error('[LocalVision] export failed:', err)
    } finally {
      this.exportBtn.disabled = false
      this.exportBtn.textContent = '⤓'
    }
  }

  /** Snapshot the current navigation state into a UrlState. */
  private snapshotUrlState(): UrlState {
    const state: UrlState = {}
    if (this.selectedCity) {
      state.city = this.selectedCity.geoid
      state.stateFips = this.selectedCity.stateFips
    }
    state.view = this.activeView
    state.level = this.activeView === 'outer' ? this.outerBoundary : this.innerBoundary
    if (this.outerView) {
      // Read the active KPI from the binding's table via the view's getStyle/state.
      // Simplest path: pull from the displayed kpi pill which carries `lv-active`.
      const active = this.kpiSlotEl.querySelector('.lv-kpi-pill.lv-active') as HTMLElement | null
      const kpi = active?.dataset?.['kpi']
      if (kpi) state.kpi = kpi
    }
    const t = this.time.currentValue()
    if (t != null) state.time = String(t)
    if (this.compareEnabled) {
      state.compare = true
      if (this.compareActiveKpi) state.compareKpi = this.compareActiveKpi
    }
    return state
  }

  /** Write the current state into the URL hash. */
  private syncUrlState(): void {
    writeUrlState(this.snapshotUrlState())
  }

  /**
   * Restore navigation from the URL hash on first load. Returns the
   * parsed state for the caller to act on (city selection, view switch,
   * level swap). Doesn't directly mutate the app — the caller decides
   * what to apply and when.
   */
  getInitialUrlState(): UrlState {
    return readUrlState()
  }

  /**
   * After both compare-mode views are mounted, attach 'move' listeners
   * so panning / zooming one mirrors to the other. Reentrancy-safe: a
   * `syncing` flag prevents the secondary view's reflected move event
   * from triggering an infinite loop. Returns a teardown that detaches
   * the listeners — called on compare-mode exit.
   */
  private wireCompareSync(a: OuterCityView, b: OuterCityView): () => void {
    const mapA = a.getMap()
    const mapB = b.getMap()
    let syncing = false
    const onA = () => {
      if (syncing) return
      syncing = true
      mapB.jumpTo({ center: mapA.getCenter(), zoom: mapA.getZoom(), bearing: mapA.getBearing(), pitch: mapA.getPitch() })
      syncing = false
    }
    const onB = () => {
      if (syncing) return
      syncing = true
      mapA.jumpTo({ center: mapB.getCenter(), zoom: mapB.getZoom(), bearing: mapB.getBearing(), pitch: mapB.getPitch() })
      syncing = false
    }
    mapA.on('move', onA)
    mapB.on('move', onB)
    return () => {
      mapA.off('move', onA)
      mapB.off('move', onB)
    }
  }

  /**
   * Pick a sensible "second KPI" for compare mode. Prefers the second
   * compatible KPI in the binding's variable list (skipping the active
   * one). Falls back to the active KPI when the binding only has one.
   */
  private pickCompareKpi(binding: import('../data/types').DataBinding, primaryKpi: string): string {
    const level = binding.table.meta?.geographyLevel
    const compatible = binding.table.variables.filter((v) => {
      if (!level || !v.availableAtLevels || v.availableAtLevels.length === 0) return true
      return v.availableAtLevels.includes(level)
    })
    const secondary = compatible.find((v) => v.key !== primaryKpi) ?? compatible[0]
    return secondary?.key ?? primaryKpi
  }

  /**
   * Build the settings popover. Sections: color scheme, fill opacity,
   * boundary color, boundary pattern, boundary width. Each control writes
   * through `applyAndPersistStyle(...)` so changes survive page reloads.
   * Initial control values reflect any previously-persisted settings.
   */
  private buildSettingsPanel(): HTMLElement {
    const persisted = this.loadPersistedStyle() ?? {}
    const init = {
      scheme:      persisted.scheme      ?? 'default',
      fillOpacity: persisted.fillOpacity ?? 0.65,
      lineColor:   persisted.lineColor   ?? 'auto',
      lineWidth:   persisted.lineWidth   ?? 1,
      linePattern: persisted.linePattern ?? 'solid',
    }

    const panel = document.createElement('div')
    panel.className = 'lv-settings-panel'

    const header = document.createElement('div')
    header.className = 'lv-settings-header'
    header.textContent = 'Display settings'
    panel.appendChild(header)

    // 1. Color scheme
    const schemeSection = section('Color scheme')
    const schemeRow = document.createElement('div')
    schemeRow.className = 'lv-scheme-row'
    const schemes: { key: string; label: string; palette: string[] }[] = [
      { key: 'default', label: 'Blue → Green',     palette: ['#1e3a5f', '#bfdbfe', '#10b981'] },
      { key: 'blues',   label: 'Sequential Blues', palette: ['#f0f9ff', '#38bdf8', '#0c4a6e'] },
      { key: 'viridis', label: 'Viridis',          palette: ['#440154', '#21908c', '#fde725'] },
      { key: 'magma',   label: 'Magma',            palette: ['#000004', '#b73779', '#fcfdbf'] },
      { key: 'redblue', label: 'Red ↔ Blue',       palette: ['#67001f', '#f7f7f7', '#053061'] },
      { key: 'cbSafeSequential', label: 'CB-safe sequential', palette: ['#ffffd9', '#41b6c4', '#081d58'] },
      { key: 'cbSafeDiverging',  label: 'CB-safe diverging',  palette: ['#a50026', '#fee090', '#313695'] },
    ]
    schemes.forEach((s) => {
      const btn = document.createElement('button')
      btn.className = 'lv-scheme-swatch'
      btn.title = s.label
      btn.dataset['scheme'] = s.key
      btn.style.background = `linear-gradient(to right, ${s.palette[0]}, ${s.palette[1]}, ${s.palette[2]})`
      if (s.key === init.scheme) btn.classList.add('lv-active')
      btn.addEventListener('click', () => {
        schemeRow.querySelectorAll('.lv-scheme-swatch').forEach((b) => b.classList.remove('lv-active'))
        btn.classList.add('lv-active')
        this.applyAndPersistStyle({ scheme: s.key as never })
      })
      schemeRow.appendChild(btn)
    })
    schemeSection.appendChild(schemeRow)
    panel.appendChild(schemeSection)

    // 2. Fill opacity
    const opSection = section('Fill opacity')
    const opRow = document.createElement('div')
    opRow.className = 'lv-settings-control-row'
    const opPct = Math.round(init.fillOpacity * 100)
    const opSlider = slider(0, 100, opPct, 1)
    const opLabel = document.createElement('span')
    opLabel.className = 'lv-settings-value'
    opLabel.textContent = `${opPct}%`
    opSlider.addEventListener('input', () => {
      const v = parseInt(opSlider.value, 10)
      opLabel.textContent = `${v}%`
      this.applyAndPersistStyle({ fillOpacity: v / 100 })
    })
    opRow.appendChild(opSlider)
    opRow.appendChild(opLabel)
    opSection.appendChild(opRow)
    panel.appendChild(opSection)

    // 3. Boundary color
    const lcSection = section('Boundary color')
    const lcRow = document.createElement('div')
    lcRow.className = 'lv-line-color-row'
    const lineColorPresets: { key: string; label: string; swatch: string }[] = [
      { key: 'auto',    label: 'Auto (bg)', swatch: '#0F1117' },
      { key: '#ffffff', label: 'White',     swatch: '#ffffff' },
      { key: '#000000', label: 'Black',     swatch: '#000000' },
      { key: '#fbbf24', label: 'Amber',     swatch: '#fbbf24' },
    ]
    lineColorPresets.forEach((p) => {
      const btn = document.createElement('button')
      btn.className = 'lv-line-color-swatch'
      btn.title = p.label
      btn.dataset['lineColor'] = p.key
      btn.style.background = p.swatch
      if (p.key === init.lineColor) btn.classList.add('lv-active')
      btn.addEventListener('click', () => {
        lcRow.querySelectorAll('.lv-line-color-swatch').forEach((b) => b.classList.remove('lv-active'))
        btn.classList.add('lv-active')
        this.applyAndPersistStyle({ lineColor: p.key as never })
      })
      lcRow.appendChild(btn)
    })
    lcSection.appendChild(lcRow)
    panel.appendChild(lcSection)

    // 4. Boundary pattern (solid / dashed / dotted / dash-dot)
    const lpSection = section('Boundary pattern')
    const lpRow = document.createElement('div')
    lpRow.className = 'lv-line-pattern-row'
    const patterns: { key: string; label: string; preview: string }[] = [
      { key: 'solid',    label: 'Solid',    preview: '─────────' },
      { key: 'dashed',   label: 'Dashed',   preview: '─ ─ ─ ─' },
      { key: 'dotted',   label: 'Dotted',   preview: '· · · · · · ·' },
      { key: 'dash-dot', label: 'Dash-dot', preview: '─ · ─ · ─' },
    ]
    patterns.forEach((p) => {
      const btn = document.createElement('button')
      btn.className = 'lv-line-pattern-btn'
      btn.title = p.label
      btn.dataset['linePattern'] = p.key
      btn.textContent = p.preview
      if (p.key === init.linePattern) btn.classList.add('lv-active')
      btn.addEventListener('click', () => {
        lpRow.querySelectorAll('.lv-line-pattern-btn').forEach((b) => b.classList.remove('lv-active'))
        btn.classList.add('lv-active')
        this.applyAndPersistStyle({ linePattern: p.key as never })
      })
      lpRow.appendChild(btn)
    })
    lpSection.appendChild(lpRow)
    panel.appendChild(lpSection)

    // 5. Boundary width
    const lwSection = section('Boundary width')
    const lwRow = document.createElement('div')
    lwRow.className = 'lv-settings-control-row'
    const lwSlider = slider(0, 4, init.lineWidth, 0.5)
    const lwLabel = document.createElement('span')
    lwLabel.className = 'lv-settings-value'
    lwLabel.textContent = `${init.lineWidth.toFixed(1)} px`
    lwSlider.addEventListener('input', () => {
      const v = parseFloat(lwSlider.value)
      lwLabel.textContent = `${v.toFixed(1)} px`
      this.applyAndPersistStyle({ lineWidth: v })
    })
    lwRow.appendChild(lwSlider)
    lwRow.appendChild(lwLabel)
    lwSection.appendChild(lwRow)
    panel.appendChild(lwSection)

    // 6. Map layers — OSM-backed overlay presets
    const layersSection = section('Map layers')
    const layersList = document.createElement('div')
    layersList.className = 'lv-layers-list'
    const persistedLayers = this.loadPersistedLayers()
    Object.values(LAYER_PRESETS).forEach((preset) => {
      const row = document.createElement('div')
      row.className = 'lv-layer-row'

      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.className = 'lv-layer-checkbox'
      cb.id = `lv-layer-${preset.id}`
      const persisted = persistedLayers[preset.id]
      cb.checked = persisted?.active ?? false

      const label = document.createElement('label')
      label.htmlFor = cb.id
      label.className = 'lv-layer-label'
      label.textContent = preset.label

      const status = document.createElement('span')
      status.className = 'lv-layer-status'

      const opSlider = document.createElement('input')
      opSlider.type = 'range'
      opSlider.className = 'lv-layer-opacity'
      opSlider.min = '0'
      opSlider.max = '100'
      opSlider.step = '5'
      opSlider.value = String(Math.round((persisted?.opacity ?? 1) * 100))
      opSlider.disabled = !cb.checked
      opSlider.addEventListener('input', () => {
        const v = parseInt(opSlider.value, 10) / 100
        this.outerView?.setCustomLayerOpacity(preset.id, v)
        this.persistLayer(preset.id, { opacity: v })
      })

      cb.addEventListener('change', () => {
        opSlider.disabled = !cb.checked
        if (cb.checked) {
          status.textContent = 'loading…'
          void this.activateLayerPreset(preset.id, status).then(() => {
            this.outerView?.setCustomLayerOpacity(preset.id, parseInt(opSlider.value, 10) / 100)
          })
        } else {
          this.outerView?.setCustomLayerVisibility(preset.id, false)
          status.textContent = ''
          this.persistLayer(preset.id, { active: false })
        }
      })

      row.appendChild(cb)
      row.appendChild(label)
      row.appendChild(status)
      row.appendChild(opSlider)
      layersList.appendChild(row)
    })
    layersSection.appendChild(layersList)
    panel.appendChild(layersSection)

    // 7. Clip area — draw a polygon to focus the active view
    const clipSection = section('Clip area')
    const clipRow = document.createElement('div')
    clipRow.className = 'lv-clip-row'
    const drawBtn = document.createElement('button')
    drawBtn.className = 'lv-clip-btn'
    drawBtn.textContent = 'Draw clip area'
    drawBtn.addEventListener('click', () => this.handleClipDrawClick(drawBtn, clearBtn, hintEl))
    const clearBtn = document.createElement('button')
    clearBtn.className = 'lv-clip-btn lv-clip-btn-clear'
    clearBtn.textContent = 'Clear'
    clearBtn.style.display = this.outerView?.getClipPolygon() ? '' : 'none'
    clearBtn.addEventListener('click', () => {
      this.outerView?.setClipPolygon(null)
      clearBtn.style.display = 'none'
      drawBtn.textContent = 'Draw clip area'
    })
    const hintEl = document.createElement('div')
    hintEl.className = 'lv-clip-hint'
    hintEl.textContent = 'Click to add points · double-click to finish · Esc to cancel'
    hintEl.style.display = 'none'

    clipRow.appendChild(drawBtn)
    clipRow.appendChild(clearBtn)
    clipSection.appendChild(clipRow)
    clipSection.appendChild(hintEl)
    panel.appendChild(clipSection)

    return panel

    function section(label: string): HTMLElement {
      const s = document.createElement('div')
      s.className = 'lv-settings-section'
      const l = document.createElement('label')
      l.textContent = label
      s.appendChild(l)
      return s
    }
    function slider(min: number, max: number, value: number, step: number): HTMLInputElement {
      const r = document.createElement('input')
      r.type = 'range'
      r.className = 'lv-settings-slider'
      r.min = String(min)
      r.max = String(max)
      r.value = String(value)
      r.step = String(step)
      return r
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

const TRAILING_STATE_ABBR_RE = /\s*,\s*([A-Za-z]{2})\s*$/
const LSAD_SUFFIX_RE = /\s+(city|town|village|borough|CDP|township|municipality|comunidad|zona urbana)$/i

/** Strip trailing state abbr and LSAD descriptor, lower-case, trim. */
function normalizeCityQuery(q: string): string {
  return q
    .toLowerCase()
    .trim()
    .replace(TRAILING_STATE_ABBR_RE, '')
    .replace(LSAD_SUFFIX_RE, '')
    .trim()
}

/** Pull the trailing ", XX" state abbreviation out of a search query. */
function extractStateAbbr(q: string): string | null {
  const m = q.match(TRAILING_STATE_ABBR_RE)
  return m ? m[1].toLowerCase() : null
}
