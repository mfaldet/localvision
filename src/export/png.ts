/**
 * PNG export utilities. Two flavours:
 *
 *  - exportMapPng()  — captures just the MapLibre canvas. Fast (one
 *                       toBlob call) but excludes HTML overlays like
 *                       the chart panel and the header.
 *  - exportAppPng()  — captures the whole app via html-to-image-style
 *                       SVG-foreignObject trick. Heavier but produces a
 *                       complete screenshot ready to share.
 *
 * Both trigger a browser download via a transient anchor element.
 */

import type { Map as MlMap } from 'maplibre-gl'

/**
 * Export just the MapLibre canvas as a PNG. The MapLibre canvas
 * preserves a drawing buffer that we can grab directly via toBlob.
 */
export async function exportMapPng(map: MlMap, filename = 'map.png'): Promise<void> {
  // Force a redraw so the canvas reflects the latest paint state. The
  // map renders on demand; without a forced frame we can capture a stale
  // buffer.
  map.triggerRepaint()
  await waitForIdle(map)

  const canvas = map.getCanvas()
  const blob = await canvasToBlob(canvas)
  triggerDownload(blob, filename)
}

/**
 * Export a whole DOM element (typically the LocalVisionApp root) as a PNG:
 * the element is cloned, its styles are written inline, and the clone is
 * drawn through an SVG <foreignObject> onto a canvas.
 *
 * Two details make this work in Chrome:
 *  - The SVG is handed over as a data: URL. Chrome treats a blob: URL that
 *    contains a foreignObject as cross-origin and refuses to export the
 *    canvas afterwards ("tainted canvas").
 *  - A cloned <canvas> is blank, so each map passed in `maps` is captured
 *    as an image during one of its own render frames (the only moment a
 *    WebGL canvas without preserveDrawingBuffer can be read) and put in the
 *    clone in place of its canvas.
 *
 * Basemap tiles must come from a server that allows cross-origin use.
 */
export async function exportAppPng(
  root: HTMLElement,
  filename = 'localvision.png',
  maps: MlMap[] = [],
): Promise<void> {
  const rect = root.getBoundingClientRect()
  const width = Math.ceil(rect.width)
  const height = Math.ceil(rect.height)

  // 1. Capture every map while it is drawing.
  const shots = new Map<HTMLCanvasElement, string>()
  for (const map of maps) shots.set(map.getCanvas(), await captureMap(map))

  // 2. Clone, inline styles, swap map canvases for their captures.
  const clone = root.cloneNode(true) as HTMLElement
  inlineComputedStyles(root, clone)
  const sourceCanvases = root.querySelectorAll('canvas')
  clone.querySelectorAll('canvas').forEach((canvas, i) => {
    const shot = shots.get(sourceCanvases[i])
    if (!shot) return
    const img = document.createElement('img')
    img.src = shot
    img.setAttribute('style', canvas.getAttribute('style') ?? '')
    img.style.width = '100%'
    img.style.height = '100%'
    canvas.replaceWith(img)
  })
  // Form controls keep their current state in properties, which a clone and
  // the serializer do not carry. Write them back as attributes.
  const sourceFields = root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')
  clone.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((field, i) => {
    const source = sourceFields[i]
    if (field instanceof HTMLSelectElement) {
      Array.from(field.options).forEach((o, n) => o.toggleAttribute('selected', n === (source as HTMLSelectElement).selectedIndex))
    } else {
      field.setAttribute('value', source.value)
    }
  })
  // Scrollbars and the button that started the export do not belong in the picture
  clone.querySelectorAll<HTMLElement>('.lv-chart-pane').forEach((el) => { el.style.overflow = 'hidden' })
  clone.querySelectorAll('.lv-export-btn, .lv-tooltip').forEach((el) => el.remove())
  // Controls that make no sense in a picture
  clone.querySelectorAll('.maplibregl-ctrl-top-left, .lv-settings-panel, .lv-loading-overlay').forEach((el) => el.remove())

  // 3. Draw the clone through an SVG foreignObject.
  const xhtml = new XMLSerializer().serializeToString(clone)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
  const scale = Math.min(window.devicePixelRatio || 1, 2)
  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0)
  triggerDownload(await canvasToBlob(canvas), filename)
}

/** Read a map's pixels during one of its render frames. */
function captureMap(map: MlMap): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('map did not render in time for the export')), 5000)
    map.once('render', () => {
      clearTimeout(timer)
      try {
        resolve(map.getCanvas().toDataURL('image/png'))
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    map.triggerRepaint()
  })
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob produced no blob'))), 'image/png')
  })
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = (e) => reject(new Error(`image load failed: ${e}`))
    img.src = src
  })
}

/**
 * Wait for the MapLibre map to be 'idle' (no in-flight renders or
 * source updates), then resolve. Capped at 1500ms so a stuck source
 * doesn't hang the export.
 */
function waitForIdle(map: MlMap, timeoutMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false
    const finish = () => {
      if (resolved) return
      resolved = true
      map.off('idle', finish)
      resolve()
    }
    map.once('idle', finish)
    setTimeout(finish, timeoutMs)
  })
}

/**
 * Recursively walk source + clone trees, copying every computed style
 * onto the clone as an inline style. Without this, the SVG render uses
 * the document's default styles only.
 *
 * The inside of a chart <svg> is left alone: its marks already carry their
 * own attributes, and a chart can hold thousands of them.
 */
function inlineComputedStyles(source: Element, target: Element): void {
  const computed = window.getComputedStyle(source)
  let cssText = ''
  for (let i = 0; i < computed.length; i++) {
    const prop = computed.item(i)
    cssText += `${prop}:${computed.getPropertyValue(prop)};`
  }
  ;(target as HTMLElement).style.cssText = cssText
  if (source.tagName.toLowerCase() === 'svg') return

  const srcChildren = source.children
  const tgtChildren = target.children
  for (let i = 0; i < srcChildren.length; i++) {
    inlineComputedStyles(srcChildren[i], tgtChildren[i])
  }
}
