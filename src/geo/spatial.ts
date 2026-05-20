/**
 * Lightweight spatial primitives for LocalVision. Just enough to answer
 * "which feature contains this city?" without pulling in a full geospatial
 * library. All algorithms are well-known and operate on GeoJSON coordinates
 * in [longitude, latitude] order.
 */

import type { GeoJsonFeature, GeoJsonGeometry } from '../types'

/** Bounding box: [west, south, east, north]. */
export type BBox = [number, number, number, number]

/** Compute the bounding box of any GeoJSON geometry. */
export function bbox(geom: GeoJsonGeometry): BBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of collectCoords(geom)) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return [minX, minY, maxX, maxY]
}

/** Geometric center of a geometry's bounding box. */
export function bboxCenter(geom: GeoJsonGeometry): [number, number] {
  const [w, s, e, n] = bbox(geom)
  return [(w + e) / 2, (s + n) / 2]
}

/**
 * Point-in-polygon (ray casting, handles holes). Returns true when `point`
 * is inside `geom` (Polygon or MultiPolygon). Points exactly on the boundary
 * may be classified inconsistently — acceptable for our use case where we
 * pass interior centroids.
 */
export function pointInPolygon(point: [number, number], geom: GeoJsonGeometry): boolean {
  if (geom.type === 'Polygon') return pointInPolygonRings(point, geom.coordinates)
  if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      if (pointInPolygonRings(point, poly)) return true
    }
    return false
  }
  return false
}

/**
 * Find the first feature in `features` whose geometry contains `point`.
 * Returns null if none. O(N) — fine for state-level lookups (~few thousand
 * features at most).
 */
export function findFeatureContaining(
  point: [number, number],
  features: GeoJsonFeature[],
): GeoJsonFeature | null {
  for (const f of features) {
    if (pointInPolygon(point, f.geometry)) return f
  }
  return null
}

// ─── Internal ────────────────────────────────────────────────────────────────

function pointInPolygonRings(point: [number, number], rings: number[][][]): boolean {
  if (rings.length === 0) return false
  // First ring is the outer; subsequent rings are holes
  if (!pointInRing(point, rings[0])) return false
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(point, rings[i])) return false
  }
  return true
}

function pointInRing(point: [number, number], ring: number[][]): boolean {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function collectCoords(geom: GeoJsonGeometry): number[][] {
  switch (geom.type) {
    case 'Polygon':      return geom.coordinates.flat()
    case 'MultiPolygon': return geom.coordinates.flat(2)
    case 'Point':        return [geom.coordinates]
    case 'LineString':   return geom.coordinates
    default:             return []
  }
}
