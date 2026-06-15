/**
 * Timing utilities for coalescing rapid event bursts (time-slider
 * scrubbing, resize, selection storms) into fewer expensive operations.
 */

/**
 * requestAnimationFrame-based throttle. The wrapped function runs at most
 * once per animation frame, always with the latest arguments. Ideal for
 * work that drives a visual update — multiple calls within a frame
 * collapse to a single render aligned to the browser's paint cycle.
 *
 * Falls back to setTimeout(0) when rAF is unavailable (SSR / tests).
 */
export function rafThrottle<A extends unknown[]>(
  fn: (...args: A) => void,
): ((...args: A) => void) & { cancel: () => void } {
  let scheduled = false
  let lastArgs: A | null = null
  let handle = 0

  const raf =
    typeof requestAnimationFrame !== 'undefined'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number
  const caf =
    typeof cancelAnimationFrame !== 'undefined'
      ? cancelAnimationFrame
      : (h: number) => clearTimeout(h)

  const throttled = (...args: A): void => {
    lastArgs = args
    if (scheduled) return
    scheduled = true
    handle = raf(() => {
      scheduled = false
      if (lastArgs) fn(...lastArgs)
      lastArgs = null
    })
  }

  throttled.cancel = () => {
    if (scheduled) {
      caf(handle)
      scheduled = false
      lastArgs = null
    }
  }

  return throttled
}

/**
 * Trailing-edge debounce. The wrapped function runs `waitMs` after the
 * last call; earlier calls within the window are discarded. Use for work
 * that should only fire once the user has stopped (e.g. re-rendering the
 * chart panel after they finish dragging the time slider).
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
): ((...args: A) => void) & { cancel: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: A | null = null

  const debounced = (...args: A): void => {
    lastArgs = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (lastArgs) fn(...lastArgs)
      lastArgs = null
    }, waitMs)
  }

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
      lastArgs = null
    }
  }

  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
      if (lastArgs) fn(...lastArgs)
      lastArgs = null
    }
  }

  return debounced
}
