import type { LocalVisionAppOptions, ViewMode, LocalVisionEventMap } from '../types'
import { resolveTheme, applyThemeToDom } from '../theme/tokens'
import { InnerCityView } from './InnerCityView'
import { OuterCityView } from './OuterCityView'

import '../theme/styles.css'

export class LocalVisionApp {
  private root: HTMLElement
  private headerEl: HTMLElement
  private kpiSlotEl: HTMLElement
  private bodyEl: HTMLElement
  private activeView: ViewMode
  private innerView: InnerCityView | null = null
  private outerView: OuterCityView | null = null
  private options: LocalVisionAppOptions
  private listeners: Partial<{ [K in keyof LocalVisionEventMap]: ((e: LocalVisionEventMap[K]) => void)[] }> = {}

  constructor(options: LocalVisionAppOptions) {
    this.options = options
    this.activeView = options.defaultView ?? 'outer'

    const theme = resolveTheme(options.theme)

    // Resolve container
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

    // View toggle (far left)
    const toggle = this.buildToggle()
    this.headerEl.appendChild(toggle)

    // Divider (shown only when outer view is active and has KPI pills)
    const divider = document.createElement('div')
    divider.className = 'lv-header-divider'
    divider.id = 'lv-header-divider'
    this.headerEl.appendChild(divider)

    // KPI slot — OuterCityView renders its pills here
    this.kpiSlotEl = document.createElement('div')
    this.kpiSlotEl.className = 'lv-kpi-selector'
    this.headerEl.appendChild(this.kpiSlotEl)

    this.root.appendChild(this.headerEl)

    // ── Body ─────────────────────────────────────────────────────────────────
    this.bodyEl = document.createElement('div')
    this.bodyEl.className = 'lv-app-body'
    this.root.appendChild(this.bodyEl)

    this.mountView(this.activeView)
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  switchTo(view: ViewMode): void {
    if (view === this.activeView) return
    this.destroyActiveView()
    this.activeView = view
    this.updateToggleUI()
    this.mountView(view)
  }

  on<K extends keyof LocalVisionEventMap>(
    event: K,
    handler: (e: LocalVisionEventMap[K]) => void,
  ): this {
    if (!this.listeners[event]) this.listeners[event] = [] as never
    ;(this.listeners[event] as ((e: LocalVisionEventMap[K]) => void)[]).push(handler)
    // Forward to active view if already mounted
    this.innerView?.on(event, handler)
    this.outerView?.on(event, handler)
    return this
  }

  destroy(): void {
    this.destroyActiveView()
    this.root.innerHTML = ''
    this.root.classList.remove('lv-root')
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private mountView(view: ViewMode): void {
    this.bodyEl.innerHTML = ''
    this.kpiSlotEl.innerHTML = ''

    const divider = document.getElementById('lv-header-divider')

    if (view === 'inner') {
      if (divider) divider.style.display = 'none'

      const container = document.createElement('div')
      container.style.cssText = 'width:100%;height:100%;'
      this.bodyEl.appendChild(container)

      this.innerView = new InnerCityView({
        ...this.options.inner,
        container,
        theme: this.options.theme,
      })

      // Forward existing listeners
      this.forwardListeners(this.innerView)

    } else {
      if (divider) divider.style.display = ''

      const container = document.createElement('div')
      container.style.cssText = 'width:100%;height:100%;'
      this.bodyEl.appendChild(container)

      this.outerView = new OuterCityView({
        ...this.options.outer,
        container,
        theme: this.options.theme,
        headerEl: this.kpiSlotEl,
      })

      // Forward existing listeners
      this.forwardListeners(this.outerView)
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
      const handlers = this.listeners[k] as ((e: never) => void)[] | undefined
      handlers?.forEach((h) => view.on(k, h as never))
    })
  }

  private buildToggle(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'lv-view-toggle'
    wrap.id = 'lv-view-toggle'

    const modes: { id: ViewMode; label: string }[] = [
      { id: 'inner', label: 'Inner City' },
      { id: 'outer', label: 'Outer City' },
    ]

    modes.forEach(({ id, label }) => {
      const btn = document.createElement('button')
      btn.className = `lv-view-toggle-btn${id === this.activeView ? ' lv-active' : ''}`
      btn.dataset['view'] = id
      btn.textContent = label
      btn.addEventListener('click', () => this.switchTo(id))
      wrap.appendChild(btn)
    })

    return wrap
  }

  private updateToggleUI(): void {
    const toggle = document.getElementById('lv-view-toggle')
    if (!toggle) return
    toggle.querySelectorAll<HTMLButtonElement>('.lv-view-toggle-btn').forEach((btn) => {
      btn.classList.toggle('lv-active', btn.dataset['view'] === this.activeView)
    })
  }
}
