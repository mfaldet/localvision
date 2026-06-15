/**
 * anywidget entry point. Mounts a LocalVisionApp into the Jupyter cell
 * element, with three Python-side traits driving its behaviour:
 *
 *   - binding:    JSON string of the DataBinding (boundaries + table)
 *   - active_kpi: which variable drives the choropleth
 *   - config:     extra LocalVisionApp options (theme, defaults, etc.)
 *
 * The widget reacts to trait changes by updating the running view:
 * `active_kpi` becomes `setActiveKpi`, full `binding` swaps become
 * `updateBinding`. Selection events from the JS side flow back via
 * `model.set('selected', ...)` (TODO).
 *
 * Bundled by `python/vite.config.ts` into `python/localvision_py/static/widget.js`.
 */

import { LocalVisionApp } from '../../src/index'

interface AnyWidgetModel {
  get(key: string): unknown
  on(event: string, handler: () => void): void
  set(key: string, value: unknown): void
  save_changes(): void
}

interface RenderArgs {
  model: AnyWidgetModel
  el: HTMLElement
}

export default {
  render({ model, el }: RenderArgs): () => void {
    // Container styling — let the Python side control sizing via traits.
    const width = String(model.get('width') ?? '100%')
    const height = String(model.get('height') ?? '600px')
    const container = document.createElement('div')
    container.style.cssText = `width:${width};height:${height};position:relative;`
    el.appendChild(container)

    // Parse the binding JSON. Both string and pre-parsed dict accepted on
    // the Python side; on the wire it's always a string trait.
    let binding: { boundaries: unknown; table: unknown; geoidProperty?: string }
    try {
      binding = JSON.parse(String(model.get('binding') ?? '{}'))
    } catch (err) {
      container.textContent = `[LocalVision] binding JSON parse failed: ${err}`
      return () => container.remove()
    }

    const activeKpi = String(model.get('active_kpi') ?? '')
    const config = (model.get('config') as Record<string, unknown>) ?? {}

    // Construct the app. Both views share the same binding so the user
    // can toggle Inner ↔ Outer immediately. drillProvider is NOT wired
    // in the widget shell — for that, the user provides their own data.
    const app = new LocalVisionApp({
      container,
      defaultView: (config.defaultView as 'inner' | 'outer' | undefined) ?? 'outer',
      outer: {
        binding: binding as never,
        activeKpi,
      },
      inner: {
        boundary: { type: 'FeatureCollection', features: [] },
        kpis: [{ id: 'placeholder', label: 'placeholder', format: 'number', data: [] }],
        charts: [{ type: 'bar', kpiId: 'placeholder' }],
      },
      ...(config as Record<string, unknown>),
    } as never)

    // Wire trait reactions
    model.on('change:active_kpi', () => {
      const next = String(model.get('active_kpi') ?? '')
      // OuterCityView exposes setActiveKpi; the app forwards it via outerView
      ;(app as unknown as { outerView?: { setActiveKpi: (id: string) => void } })
        .outerView?.setActiveKpi(next)
    })
    model.on('change:binding', () => {
      try {
        const next = JSON.parse(String(model.get('binding') ?? '{}'))
        ;(app as unknown as { outerView?: { updateBinding: (b: unknown) => void } })
          .outerView?.updateBinding(next)
      } catch (err) {
        console.error('[LocalVision widget] failed to update binding:', err)
      }
    })

    // Cleanup hook called when the widget is removed
    return () => {
      ;(app as unknown as { destroy?: () => void }).destroy?.()
      container.remove()
    }
  },
}
