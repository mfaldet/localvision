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
 * Export a whole DOM element (typically the LocalVisionApp root) as a
 * PNG. Uses the SVG-foreignObject technique: serialize the element to
 * SVG, render onto a canvas, export.
 *
 * Notes:
 *  - The MapLibre canvas needs `preserveDrawingBuffer: true` to be
 *    captured this way; without it, the map area will be blank in the
 *    screenshot. LocalVision sets this when running in export mode (TODO).
 *  - Cross-origin images (basemap tiles) need CORS-friendly tile servers.
 */
export async function exportAppPng(root: HTMLElement, filename = 'localvision.png'): Promise<void> {
  const rect = root.getBoundingClientRect()
  const width = Math.ceil(rect.width)
  const height = Math.ceil(rect.height)

  // 1. Build an inlined SVG-foreignObject wrapping a cloned subtree.
  const clone = root.cloneNode(true) as HTMLElement
  // Inline computed styles so the cloned subtree renders without external CSS.
  inlineComputedStyles(root, clone)
  const xhtml = new XMLSerializer().serializeToString(clone)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)

  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = width * (window.devicePixelRatio || 1)
    canvas.height = height * (window.devicePixelRatio || 1)
    const ctx = canvas.getContext('2d')!
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1)
    ctx.drawImage(img, 0, 0)
    const blob = await canvasToBlob(canvas)
    triggerDownload(blob, filename)
  } finally {
    URL.revokeObjectURL(url)
  }
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
 */
function inlineComputedStyles(source: Element, target: Element): void {
  const computed = window.getComputedStyle(source)
  let cssText = ''
  for (let i = 0; i < computed.length; i++) {
    const prop = computed.item(i)
    cssText += `${prop}:${computed.getPropertyValue(prop)};`
  }
  ;(target as HTMLElement).style.cssText = cssText

  const srcChildren = source.children
  const tgtChildren = target.children
  for (let i = 0; i < srcChildren.length; i++) {
    inlineComputedStyles(srcChildren[i], tgtChildren[i])
  }
}
