/**
 * Pure aggregation helpers for the comparison panel's distribution cards.
 *
 * Kept dependency-free + side-effect-free so they can run either on the
 * main thread (small datasets) or inside a web worker (large datasets —
 * block-group level across many KPIs). The worker wrapper in
 * `aggregate-client.ts` calls exactly these functions.
 */

export interface DistributionStats {
  count: number
  min: number
  max: number
  median: number
  mean: number
  /** Histogram bins: evenly-spaced buckets over [min, max]. */
  bins: { x0: number; x1: number; count: number }[]
}

/**
 * Compute summary stats + a histogram for a numeric series. Non-finite
 * values are dropped. Returns a zeroed result for an empty series.
 *
 * @param values   raw numbers (NaN / Infinity filtered out)
 * @param binCount number of histogram buckets (default 12)
 */
export function computeDistributionStats(
  values: number[],
  binCount = 12,
): DistributionStats {
  const clean = values.filter((v) => typeof v === 'number' && isFinite(v))
  if (clean.length === 0) {
    return { count: 0, min: 0, max: 0, median: 0, mean: 0, bins: [] }
  }

  const sorted = [...clean].sort((a, b) => a - b)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const median = quantileSorted(sorted, 0.5)
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length

  const bins = histogram(sorted, min, max, binCount)
  return { count: clean.length, min, max, median, mean, bins }
}

/**
 * Compute stats for many series at once — one call, one worker round-trip.
 * Keyed by the series id (e.g. KPI key).
 */
export function computeManyDistributions(
  seriesById: Record<string, number[]>,
  binCount = 12,
): Record<string, DistributionStats> {
  const out: Record<string, DistributionStats> = {}
  for (const [id, values] of Object.entries(seriesById)) {
    out[id] = computeDistributionStats(values, binCount)
  }
  return out
}

// ─── internals ───────────────────────────────────────────────────────────────

/** Linear-interpolated quantile over a pre-sorted ascending array. */
function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  const frac = pos - lo
  return sorted[lo] * (1 - frac) + sorted[hi] * frac
}

function histogram(
  sorted: number[],
  min: number,
  max: number,
  binCount: number,
): { x0: number; x1: number; count: number }[] {
  const bins: { x0: number; x1: number; count: number }[] = []
  if (min === max) {
    // Degenerate range — single bin holding everything.
    return [{ x0: min, x1: max, count: sorted.length }]
  }
  const width = (max - min) / binCount
  for (let i = 0; i < binCount; i++) {
    bins.push({ x0: min + i * width, x1: min + (i + 1) * width, count: 0 })
  }
  for (const v of sorted) {
    // Clamp the index so the max value lands in the last bin.
    let idx = Math.floor((v - min) / width)
    if (idx >= binCount) idx = binCount - 1
    if (idx < 0) idx = 0
    bins[idx].count++
  }
  return bins
}
