/**
 * SelectionStore — subscribable cross-component selection state.
 *
 * Both maps and charts can read from and dispatch to this store, enabling
 * linked interactions: click a chart bar → the corresponding feature
 * highlights on the map; click a map polygon → its bar highlights in the
 * chart.
 *
 * Future expansion (Bundle 2.5 / 4):
 * - Per-KPI brush ranges (numeric filtering)
 * - Time range filter
 * - Multi-select with rectangle drag on map
 */

export interface SelectionState {
  /** Feature GEOIDs currently in the selection set. */
  selected: ReadonlySet<string>
  /** Currently-hovered feature GEOID, if any. */
  hovered: string | null
}

export type SelectionMode = 'replace' | 'add' | 'toggle'

export type SelectionListener = (state: SelectionState) => void

export class SelectionStore {
  private _selected = new Set<string>()
  private _hovered: string | null = null
  private listeners = new Set<SelectionListener>()

  // ── Reads ────────────────────────────────────────────────────────────────────

  getSnapshot(): SelectionState {
    return { selected: this._selected, hovered: this._hovered }
  }

  isSelected(id: string): boolean {
    return this._selected.has(id)
  }

  isHovered(id: string): boolean {
    return this._hovered === id
  }

  hasSelection(): boolean {
    return this._selected.size > 0
  }

  // ── Mutations ────────────────────────────────────────────────────────────────

  selectFeatures(ids: string[], mode: SelectionMode = 'replace'): void {
    switch (mode) {
      case 'replace':
        this._selected = new Set(ids)
        break
      case 'add':
        ids.forEach((id) => this._selected.add(id))
        break
      case 'toggle':
        ids.forEach((id) => {
          if (this._selected.has(id)) this._selected.delete(id)
          else this._selected.add(id)
        })
        break
    }
    this.emit()
  }

  clear(): void {
    if (this._selected.size === 0) return
    this._selected = new Set()
    this.emit()
  }

  setHovered(id: string | null): void {
    if (this._hovered === id) return
    this._hovered = id
    this.emit()
  }

  // ── Subscription ─────────────────────────────────────────────────────────────

  subscribe(listener: SelectionListener): () => void {
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
