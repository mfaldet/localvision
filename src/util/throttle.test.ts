import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { rafThrottle, debounce } from './throttle'

describe('rafThrottle', () => {
  // Stub requestAnimationFrame with a controllable queue so we can flush
  // frames deterministically (happy-dom's real rAF isn't faked by vitest).
  let frameQueue: FrameRequestCallback[]

  beforeEach(() => {
    frameQueue = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frameQueue.push(cb)
      return frameQueue.length
    })
    vi.stubGlobal('cancelAnimationFrame', (h: number) => {
      frameQueue[h - 1] = (() => {}) as FrameRequestCallback
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const flushFrame = () => {
    const q = frameQueue
    frameQueue = []
    q.forEach((cb) => cb(0))
  }

  it('coalesces multiple calls within a frame into one', () => {
    const fn = vi.fn()
    const throttled = rafThrottle(fn)
    throttled(1)
    throttled(2)
    throttled(3)
    expect(fn).not.toHaveBeenCalled() // nothing runs synchronously
    flushFrame()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(3) // latest args win
  })

  it('runs again on the next frame after the first fires', () => {
    const fn = vi.fn()
    const throttled = rafThrottle(fn)
    throttled('a')
    flushFrame()
    throttled('b')
    flushFrame()
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('b')
  })

  it('cancel() prevents a pending call', () => {
    const fn = vi.fn()
    const throttled = rafThrottle(fn)
    throttled('x')
    throttled.cancel()
    flushFrame()
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs once after the wait, with the latest args', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    debounced(1)
    debounced(2)
    debounced(3)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(3)
  })

  it('resets the timer on each call', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    debounced('a')
    vi.advanceTimersByTime(60)
    debounced('b') // resets the 100ms window
    vi.advanceTimersByTime(60)
    expect(fn).not.toHaveBeenCalled() // only 60ms since last call
    vi.advanceTimersByTime(40)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('b')
  })

  it('cancel() discards a pending call', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    debounced('x')
    debounced.cancel()
    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled()
  })

  it('flush() runs the pending call immediately', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    debounced('x')
    debounced.flush()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('x')
    // No double-fire after flush
    vi.advanceTimersByTime(200)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
