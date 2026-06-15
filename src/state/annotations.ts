/**
 * AnnotationStore — subscribable state for storytelling overlays.
 *
 * Three kinds of artefact:
 *   - markers   : a labeled pin dropped at a lng/lat. The dashboard
 *                 renders these as map symbols with a text label.
 *   - shapes    : freehand-drawn polygons or lines (highlight regions,
 *                 routes, callouts). Rendered as fill / line layers.
 *   - bookmarks : a saved camera + navigation snapshot the user can
 *                 jump back to. Bookmarks form the basis of a "tour".
 *
 * All persist to localStorage (per the app's persistence convention)
 * so a user's annotated view survives reloads. The store itself is
 * storage-agnostic; LocalVisionApp wires the persistence.
 */

export interface AnnotationMarker {
  id: string
  /** [lng, lat] in WGS84. */
  lngLat: [number, number]
  /** Display text. */
  label: string
  /** Optional accent color (hex). Defaults applied by the renderer. */
  color?: string
}

export interface AnnotationShape {
  id: string
  /** 'polygon' (filled region) or 'line' (route / callout). */
  kind: 'polygon' | 'line'
  /** Ordered vertices as [lng, lat] pairs. Polygons auto-close on render. */
  points: [number, number][]
  /** Optional label shown at the shape's centroid. */
  label?: string
  /** Stroke / fill color (hex). Default applied by the renderer. */
  color?: string
}

export interface Bookmark {
  id: string
  label: string
  /** Camera snapshot. */
  camera: {
    center: [number, number]
    zoom: number
    bearing: number
    pitch: number
  }
  /** Navigation snapshot (view + boundary level + active KPI). */
  nav: {
    view?: 'inner' | 'outer'
    level?: string
    kpi?: string
  }
}

export interface AnnotationState {
  markers: AnnotationMarker[]
  shapes: AnnotationShape[]
  bookmarks: Bookmark[]
}

export type AnnotationListener = (state: AnnotationState) => void

export class AnnotationStore {
  private markers: AnnotationMarker[] = []
  private shapes: AnnotationShape[] = []
  private bookmarks: Bookmark[] = []
  private listeners = new Set<AnnotationListener>()

  // ── Reads ────────────────────────────────────────────────────────────────────

  getSnapshot(): AnnotationState {
    return {
      markers: [...this.markers],
      shapes: [...this.shapes],
      bookmarks: [...this.bookmarks],
    }
  }

  // ── Hydration (from persistence) ──────────────────────────────────────────────

  /** Replace all state without firing listeners (used on initial load). */
  hydrate(state: Partial<AnnotationState>): void {
    if (state.markers) this.markers = [...state.markers]
    if (state.shapes) this.shapes = [...state.shapes]
    if (state.bookmarks) this.bookmarks = [...state.bookmarks]
    this.emit()
  }

  // ── Markers ──────────────────────────────────────────────────────────────────

  addMarker(marker: Omit<AnnotationMarker, 'id'> & { id?: string }): AnnotationMarker {
    const created: AnnotationMarker = { id: marker.id ?? makeId('m'), ...marker }
    this.markers.push(created)
    this.emit()
    return created
  }

  updateMarker(id: string, patch: Partial<Omit<AnnotationMarker, 'id'>>): void {
    const m = this.markers.find((x) => x.id === id)
    if (!m) return
    Object.assign(m, patch)
    this.emit()
  }

  removeMarker(id: string): void {
    const before = this.markers.length
    this.markers = this.markers.filter((m) => m.id !== id)
    if (this.markers.length !== before) this.emit()
  }

  // ── Shapes ───────────────────────────────────────────────────────────────────

  addShape(shape: Omit<AnnotationShape, 'id'> & { id?: string }): AnnotationShape {
    const created: AnnotationShape = { id: shape.id ?? makeId('s'), ...shape }
    this.shapes.push(created)
    this.emit()
    return created
  }

  updateShape(id: string, patch: Partial<Omit<AnnotationShape, 'id'>>): void {
    const s = this.shapes.find((x) => x.id === id)
    if (!s) return
    Object.assign(s, patch)
    this.emit()
  }

  removeShape(id: string): void {
    const before = this.shapes.length
    this.shapes = this.shapes.filter((s) => s.id !== id)
    if (this.shapes.length !== before) this.emit()
  }

  // ── Bookmarks ─────────────────────────────────────────────────────────────────

  addBookmark(bookmark: Omit<Bookmark, 'id'> & { id?: string }): Bookmark {
    const created: Bookmark = { id: bookmark.id ?? makeId('b'), ...bookmark }
    this.bookmarks.push(created)
    this.emit()
    return created
  }

  removeBookmark(id: string): void {
    const before = this.bookmarks.length
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id)
    if (this.bookmarks.length !== before) this.emit()
  }

  // ── Bulk ───────────────────────────────────────────────────────────────────────

  clear(): void {
    this.markers = []
    this.shapes = []
    this.bookmarks = []
    this.emit()
  }

  // ── Subscription ────────────────────────────────────────────────────────────────

  subscribe(listener: AnnotationListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    const snapshot = this.getSnapshot()
    this.listeners.forEach((l) => l(snapshot))
  }
}

let _idCounter = 0
function makeId(prefix: string): string {
  _idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${_idCounter}`
}
