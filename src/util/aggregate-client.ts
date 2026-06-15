/**
 * Main-thread client for the aggregation worker. Offloads distribution
 * stat computation to a web worker when the dataset is large enough to
 * matter, falling back to synchronous computation when:
 *   - workers are unavailable (SSR, older environments)
 *   - the dataset is small (worker round-trip costs more than the compute)
 *
 * Usage:
 *   const agg = new AggregationClient()
 *   const stats = await agg.compute({ income: [...], rent: [...] })
 *   agg.dispose()
 */

import { computeManyDistributions, type DistributionStats } from './aggregate'
import type { AggregateRequest, AggregateResponse } from '../workers/aggregate.worker'

/** Below this total value count, compute synchronously (worker not worth it). */
const WORKER_THRESHOLD = 2000

export class AggregationClient {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, (r: Record<string, DistributionStats>) => void>()
  private workerFailed = false

  /**
   * Compute distribution stats for a batch of series. Routes to the
   * worker for large batches, sync for small ones. Always resolves —
   * worker errors fall back to sync compute.
   */
  async compute(
    seriesById: Record<string, number[]>,
    binCount = 12,
  ): Promise<Record<string, DistributionStats>> {
    const total = Object.values(seriesById).reduce((n, arr) => n + arr.length, 0)

    if (total < WORKER_THRESHOLD || this.workerFailed || !this.supportsWorker()) {
      return computeManyDistributions(seriesById, binCount)
    }

    try {
      const worker = this.ensureWorker()
      const id = this.nextId++
      return await new Promise<Record<string, DistributionStats>>((resolve, reject) => {
        this.pending.set(id, resolve)
        const timeout = setTimeout(() => {
          this.pending.delete(id)
          reject(new Error('aggregation worker timed out'))
        }, 5000)
        const orig = this.pending.get(id)!
        this.pending.set(id, (r) => {
          clearTimeout(timeout)
          orig(r)
        })
        const req: AggregateRequest = { id, seriesById, binCount }
        worker.postMessage(req)
      })
    } catch {
      // Worker failed — disable it and fall back to sync for this + future calls.
      this.workerFailed = true
      return computeManyDistributions(seriesById, binCount)
    }
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.pending.clear()
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private supportsWorker(): boolean {
    return typeof Worker !== 'undefined' && typeof URL !== 'undefined'
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    // Vite resolves this URL at build time and bundles the worker module.
    this.worker = new Worker(new URL('../workers/aggregate.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = (e: MessageEvent<AggregateResponse>) => {
      const { id, results } = e.data
      const resolve = this.pending.get(id)
      if (resolve) {
        this.pending.delete(id)
        resolve(results)
      }
    }
    this.worker.onerror = () => {
      this.workerFailed = true
    }
    return this.worker
  }
}
