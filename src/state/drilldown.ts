/**
 * DrilldownStore — manages hierarchical navigation through nested geographies.
 *
 * Holds a stack of (level, binding) pairs. Pushing adds a deeper level
 * (e.g. county → tracts of that county). Popping navigates back up. Each
 * level caches its binding so going back is instant.
 *
 * Compatible with arbitrary level hierarchies — the library doesn't bake in
 * specific canonical paths. Users decide what "drilling into" means by
 * providing a `drillProvider` callback that returns a new DataBinding for
 * any given target.
 */

import type { OuterLevel, InnerLevel } from '../geo/levels'
import type { DataBinding } from '../data/types'

export interface DrilldownLevel {
  /** Stable identifier for this stack entry */
  id: string
  /** Human-readable label for breadcrumb display */
  label: string
  /** ADM / sub-community level this represents */
  level: OuterLevel | InnerLevel
  /**
   * Geographic context for this level. Inherited fields tell the
   * drillProvider what state / county / etc. to fetch for.
   */
  context: {
    stateFips?: string
    countyFips?: string
    tractFips?: string
  }
  /**
   * GEOID + label of the parent feature that was clicked to drill in here.
   * Absent for the root level.
   */
  parent?: {
    geoid: string
    label: string
  }
}

export interface DrilldownEntry {
  level: DrilldownLevel
  binding: DataBinding
}

export interface DrillTarget {
  /** Level we're drilling to */
  level: OuterLevel | InnerLevel
  /** The feature that was clicked to trigger the drill */
  parent: {
    geoid: string
    label: string
    properties: Record<string, unknown>
  }
  /** Inherited context */
  context: {
    stateFips?: string
    countyFips?: string
    tractFips?: string
  }
}

export type DrillProvider = (target: DrillTarget) => Promise<DataBinding | null>

export type DrilldownListener = (state: DrilldownState) => void

export interface DrilldownState {
  /** Full stack, deepest level last. */
  stack: DrilldownEntry[]
  /** Currently-active entry (top of stack). */
  current: DrilldownEntry | null
  /** True while a drill operation is in flight. */
  loading: boolean
}

export class DrilldownStore {
  private stack: DrilldownEntry[] = []
  private _loading = false
  private listeners = new Set<DrilldownListener>()

  // ── Reads ────────────────────────────────────────────────────────────────────

  getSnapshot(): DrilldownState {
    return {
      stack: [...this.stack],
      current: this.stack[this.stack.length - 1] ?? null,
      loading: this._loading,
    }
  }

  current(): DrilldownEntry | null {
    return this.stack[this.stack.length - 1] ?? null
  }

  depth(): number {
    return this.stack.length
  }

  // ── Mutations ────────────────────────────────────────────────────────────────

  /** Replace the stack with a single root entry. */
  setRoot(level: DrilldownLevel, binding: DataBinding): void {
    this.stack = [{ level, binding }]
    this.emit()
  }

  /** Push a new level onto the stack. */
  push(level: DrilldownLevel, binding: DataBinding): void {
    this.stack.push({ level, binding })
    this.emit()
  }

  /** Pop to the given depth (1 = root only). No-op if already at or below. */
  popTo(depth: number): DrilldownEntry | null {
    if (depth >= this.stack.length) return this.current()
    this.stack = this.stack.slice(0, Math.max(1, depth))
    this.emit()
    return this.current()
  }

  /** Remove the top entry, returning to the previous level. */
  pop(): DrilldownEntry | null {
    if (this.stack.length <= 1) return null
    this.stack.pop()
    this.emit()
    return this.current()
  }

  setLoading(loading: boolean): void {
    if (this._loading === loading) return
    this._loading = loading
    this.emit()
  }

  // ── Subscription ─────────────────────────────────────────────────────────────

  subscribe(listener: DrilldownListener): () => void {
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

// ─── GEOID utilities ──────────────────────────────────────────────────────────

/**
 * Extract state/county/tract FIPS components from a Census GEOID.
 * Lengths: state=2, county=3, tract=6, blockgroup=1.
 */
export function parseGeoId(geoid: string): {
  stateFips?: string
  countyFips?: string
  tractFips?: string
  blockGroup?: string
} {
  const result: ReturnType<typeof parseGeoId> = {}
  if (geoid.length >= 2) result.stateFips = geoid.slice(0, 2)
  if (geoid.length >= 5) result.countyFips = geoid.slice(2, 5)
  if (geoid.length >= 11) result.tractFips = geoid.slice(5, 11)
  if (geoid.length >= 12) result.blockGroup = geoid.slice(11, 12)
  return result
}
