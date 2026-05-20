/**
 * TimeStore — subscribable state for time-varying data playback.
 *
 * Holds the ordered timeline, the current time, playing/paused state, and
 * speed. Drives the time slider UI and the OuterCityView's choropleth.
 *
 * Mirrors the SelectionStore / DrilldownStore pattern: imperative mutation
 * methods + subscribe(listener) for observers.
 */

export type TimeValue = string | number

export interface TimeState {
  /** Ordered timeline values. Empty when no temporal data is loaded. */
  times: readonly TimeValue[]
  /** Currently active time, or null if no times. */
  current: TimeValue | null
  /** Index into times array, or -1 if no times. */
  currentIndex: number
  /** Optional label for the time axis (e.g. "Year"). */
  label?: string
  /** True when autoplay is running. */
  playing: boolean
  /** Per-step delay in ms during playback. */
  speed: number
}

export type TimeListener = (state: TimeState) => void

const DEFAULT_SPEED_MS = 800
const MIN_SPEED_MS = 100

export class TimeStore {
  private times: TimeValue[] = []
  private currentIndex = -1
  private label: string | undefined
  private _playing = false
  private _speed = DEFAULT_SPEED_MS
  private listeners = new Set<TimeListener>()
  private playTimer: ReturnType<typeof setInterval> | null = null

  // ── Reads ───────────────────────────────────────────────────────────────────

  getSnapshot(): TimeState {
    return {
      times: this.times,
      current: this.currentValue(),
      currentIndex: this.currentIndex,
      label: this.label,
      playing: this._playing,
      speed: this._speed,
    }
  }

  currentValue(): TimeValue | null {
    return this.currentIndex >= 0 ? this.times[this.currentIndex] : null
  }

  // ── Setup ───────────────────────────────────────────────────────────────────

  /**
   * Replace the timeline. Optionally set an initial time; otherwise defaults
   * to the last (most recent) time value. Pauses any active playback.
   */
  setTimes(times: TimeValue[], initialTime?: TimeValue, label?: string): void {
    this.pauseInternal()
    this.times = [...times]
    this.label = label
    if (this.times.length === 0) {
      this.currentIndex = -1
    } else if (initialTime !== undefined) {
      const idx = this.times.indexOf(initialTime)
      this.currentIndex = idx >= 0 ? idx : this.times.length - 1
    } else {
      this.currentIndex = this.times.length - 1
    }
    this.emit()
  }

  // ── Mutations ───────────────────────────────────────────────────────────────

  setCurrent(time: TimeValue): void {
    const idx = this.times.indexOf(time)
    if (idx >= 0 && idx !== this.currentIndex) {
      this.currentIndex = idx
      this.emit()
    }
  }

  setIndex(idx: number): void {
    if (idx >= 0 && idx < this.times.length && idx !== this.currentIndex) {
      this.currentIndex = idx
      this.emit()
    }
  }

  /** Advance by `delta` steps (wraps at boundaries). */
  step(delta: number = 1): void {
    if (this.times.length === 0) return
    let next = this.currentIndex + delta
    next = ((next % this.times.length) + this.times.length) % this.times.length
    if (next !== this.currentIndex) {
      this.currentIndex = next
      this.emit()
    }
  }

  play(): void {
    if (this._playing || this.times.length < 2) return
    this._playing = true
    this.playTimer = setInterval(() => this.step(1), this._speed)
    this.emit()
  }

  pause(): void {
    if (!this._playing) return
    this.pauseInternal()
    this.emit()
  }

  toggle(): void {
    this._playing ? this.pause() : this.play()
  }

  /** Playback step delay in ms; clamped to a sensible minimum. */
  setSpeed(ms: number): void {
    const clamped = Math.max(MIN_SPEED_MS, ms)
    if (clamped === this._speed) return
    this._speed = clamped
    if (this._playing) {
      // Restart timer with new cadence
      this.pauseInternal()
      this._playing = true
      this.playTimer = setInterval(() => this.step(1), this._speed)
    }
    this.emit()
  }

  // ── Subscription ────────────────────────────────────────────────────────────

  subscribe(listener: TimeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  destroy(): void {
    this.pauseInternal()
    this.listeners.clear()
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private pauseInternal(): void {
    this._playing = false
    if (this.playTimer) {
      clearInterval(this.playTimer)
      this.playTimer = null
    }
  }

  private emit(): void {
    const snapshot = this.getSnapshot()
    this.listeners.forEach((l) => l(snapshot))
  }
}
