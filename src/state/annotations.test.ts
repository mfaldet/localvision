import { describe, expect, it, vi } from 'vitest'
import { AnnotationStore } from './annotations'

describe('AnnotationStore', () => {
  it('starts empty', () => {
    const s = new AnnotationStore()
    expect(s.getSnapshot()).toEqual({ markers: [], shapes: [], bookmarks: [] })
  })

  it('adds + updates + removes shapes', () => {
    const s = new AnnotationStore()
    const sh = s.addShape({ kind: 'polygon', points: [[0, 0], [1, 0], [1, 1]] })
    expect(sh.id).toBeTruthy()
    expect(s.getSnapshot().shapes).toHaveLength(1)
    s.updateShape(sh.id, { label: 'Downtown', color: '#ff0000' })
    expect(s.getSnapshot().shapes[0].label).toBe('Downtown')
    s.removeShape(sh.id)
    expect(s.getSnapshot().shapes).toHaveLength(0)
  })

  it('adds a marker with a generated id', () => {
    const s = new AnnotationStore()
    const m = s.addMarker({ lngLat: [-93.3, 44.9], label: 'City Hall' })
    expect(m.id).toBeTruthy()
    expect(s.getSnapshot().markers).toHaveLength(1)
    expect(s.getSnapshot().markers[0].label).toBe('City Hall')
  })

  it('updates a marker', () => {
    const s = new AnnotationStore()
    const m = s.addMarker({ lngLat: [0, 0], label: 'old' })
    s.updateMarker(m.id, { label: 'new', color: '#ff0000' })
    const stored = s.getSnapshot().markers[0]
    expect(stored.label).toBe('new')
    expect(stored.color).toBe('#ff0000')
  })

  it('removes a marker', () => {
    const s = new AnnotationStore()
    const m = s.addMarker({ lngLat: [0, 0], label: 'x' })
    s.removeMarker(m.id)
    expect(s.getSnapshot().markers).toHaveLength(0)
  })

  it('adds + removes bookmarks', () => {
    const s = new AnnotationStore()
    const b = s.addBookmark({
      label: 'My View',
      camera: { center: [-93, 44], zoom: 10, bearing: 0, pitch: 0 },
      nav: { view: 'outer', level: 'county', kpi: 'income' },
    })
    expect(s.getSnapshot().bookmarks).toHaveLength(1)
    s.removeBookmark(b.id)
    expect(s.getSnapshot().bookmarks).toHaveLength(0)
  })

  it('notifies subscribers on change', () => {
    const s = new AnnotationStore()
    const listener = vi.fn()
    s.subscribe(listener)
    s.addMarker({ lngLat: [0, 0], label: 'x' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].markers).toHaveLength(1)
  })

  it('hydrates from persisted state', () => {
    const s = new AnnotationStore()
    s.hydrate({
      markers: [{ id: 'm1', lngLat: [1, 2], label: 'restored' }],
      bookmarks: [],
    })
    expect(s.getSnapshot().markers[0].label).toBe('restored')
  })

  it('clears everything', () => {
    const s = new AnnotationStore()
    s.addMarker({ lngLat: [0, 0], label: 'x' })
    s.addShape({ kind: 'line', points: [[0, 0], [1, 1]] })
    s.addBookmark({
      label: 'b',
      camera: { center: [0, 0], zoom: 1, bearing: 0, pitch: 0 },
      nav: {},
    })
    s.clear()
    expect(s.getSnapshot()).toEqual({ markers: [], shapes: [], bookmarks: [] })
  })

  it('unsubscribe stops notifications', () => {
    const s = new AnnotationStore()
    const listener = vi.fn()
    const unsub = s.subscribe(listener)
    unsub()
    s.addMarker({ lngLat: [0, 0], label: 'x' })
    expect(listener).not.toHaveBeenCalled()
  })
})
