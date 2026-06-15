/**
 * Aggregation web worker. Receives a batch of numeric series + a bin
 * count, computes distribution stats off the main thread, posts back the
 * keyed results. Pure compute — no DOM access.
 *
 * Bundled by Vite's worker support (`new Worker(new URL(...), { type:
 * 'module' })`). See aggregate-client.ts for the main-thread wrapper.
 */

import { computeManyDistributions, type DistributionStats } from '../util/aggregate'

export interface AggregateRequest {
  id: number
  seriesById: Record<string, number[]>
  binCount?: number
}

export interface AggregateResponse {
  id: number
  results: Record<string, DistributionStats>
}

self.onmessage = (e: MessageEvent<AggregateRequest>) => {
  const { id, seriesById, binCount } = e.data
  const results = computeManyDistributions(seriesById, binCount)
  const response: AggregateResponse = { id, results }
  ;(self as unknown as Worker).postMessage(response)
}
