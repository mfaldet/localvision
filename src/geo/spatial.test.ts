/**
 * Unit tests for spatial helpers — the ones that drive city-containing-
 * county lookup and the bbox-based filtering.
 */

import { describe, expect, it } from 'vitest'
import { bbox, bboxCenter, pointInPolygon, findFeatureContaining } from './spatial'
import type { GeoJsonFeature, GeoJsonGeometry } from '../types'

const unitSquare: GeoJsonGeometry = {
  type: 'Polygon',
  coordinates: [[
    [0, 0], [10, 0], [10, 10], [0, 10], [0, 0],
  ]],
}

describe('bbox', () => {
  it('computes the bbox of a polygon', () => {
    expect(bbox(unitSquare)).toEqual([0, 0, 10, 10])
  })

  it('handles a Point geometry', () => {
    expect(bbox({ type: 'Point', coordinates: [5, 5] })).toEqual([5, 5, 5, 5])
  })

  it('handles a MultiPolygon', () => {
    const mp: GeoJsonGeometry = {
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]],
      ],
    }
    expect(bbox(mp)).toEqual([0, 0, 6, 6])
  })
})

describe('bboxCenter', () => {
  it('returns the bbox midpoint', () => {
    expect(bboxCenter(unitSquare)).toEqual([5, 5])
  })
})

describe('pointInPolygon', () => {
  it('returns true for interior points', () => {
    expect(pointInPolygon([5, 5], unitSquare)).toBe(true)
  })

  it('returns false for exterior points', () => {
    expect(pointInPolygon([15, 5], unitSquare)).toBe(false)
    expect(pointInPolygon([-1, 5], unitSquare)).toBe(false)
  })

  it('handles polygons with holes', () => {
    const ring: GeoJsonGeometry = {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],   // outer
        [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]],       // hole
      ],
    }
    expect(pointInPolygon([1, 1], ring)).toBe(true)   // outer band
    expect(pointInPolygon([5, 5], ring)).toBe(false)  // inside hole
  })

  it('handles MultiPolygons (must be inside at least one part)', () => {
    const mp: GeoJsonGeometry = {
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]],
      ],
    }
    expect(pointInPolygon([0.5, 0.5], mp)).toBe(true)
    expect(pointInPolygon([5.5, 5.5], mp)).toBe(true)
    expect(pointInPolygon([3, 3], mp)).toBe(false)
  })
})

describe('findFeatureContaining', () => {
  it('returns the first containing feature', () => {
    const features: GeoJsonFeature[] = [
      { type: 'Feature', properties: { id: 'a' }, geometry: { type: 'Polygon', coordinates: [[
        [0, 0], [5, 0], [5, 5], [0, 5], [0, 0],
      ]] } },
      { type: 'Feature', properties: { id: 'b' }, geometry: { type: 'Polygon', coordinates: [[
        [5, 0], [10, 0], [10, 5], [5, 5], [5, 0],
      ]] } },
    ]
    expect(findFeatureContaining([2, 2], features)?.properties.id).toBe('a')
    expect(findFeatureContaining([7, 2], features)?.properties.id).toBe('b')
    expect(findFeatureContaining([20, 20], features)).toBeNull()
  })
})
