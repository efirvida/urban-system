/**
 * RoutingService — orchestrator for the per-leg routing pipeline.
 *
 * Responsibilities:
 *  1. Cache lookup / store via `cache.ts`.
 *  2. Chain providers in priority order, returning the first success.
 *  3. Build a full `Record<"i,j", number>` distance matrix with bounded
 *     concurrency, reporting progress along the way.
 *  4. Optionally build a cross-validated `ConsensusMatrix` from
 *     `BatchRouteProvider`s + the per-pair provider, via
 *     `ConsensusBuilder`.
 *
 * On exhaustion (all providers return `null` for a leg) the pair is
 * marked `Infinity` so downstream consumers (the optimizer) reject the
 * candidate instead of substituting a 0 or a Haversine estimate.
 */

import type { ConsensusMatrix } from '@/types';
import { ConsensusBuilder } from './consensusBuilder';
import type { OnConsensusProgress } from './consensusBuilder';
import { getCachedLeg, setCachedLeg } from './cache';
import type { BatchRouteProvider, Point, RouteLegResult, RouteProvider } from './types';

/** Progress shape consumed by the loading UI in `ResultsPanel`. */
export interface MatrixProgress {
  phase: 'matrix';
  stage: string;
  current: number;
  total: number;
  percent: number;
  etaSeconds: number;
  geoapifyCount: number;
  osrmCount: number;
  unreachableCount: number;
}

export type ProgressCallback = (p: MatrixProgress) => void;

const MATRIX_CONCURRENCY = 5;
const PROGRESS_EVERY = 10;

export class RoutingService {
  private readonly providers: RouteProvider[];

  constructor(providers: RouteProvider[]) {
    // Defensive copy + sort so callers can mutate their own array safely.
    this.providers = [...providers].sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get the real-road route between two points. Returns `null` when no
   * provider in the chain could resolve the leg (pair is unreachable).
   * Cache hits short-circuit the chain entirely.
   */
  async route(a: Point, b: Point): Promise<RouteLegResult | null> {
    const cached = getCachedLeg(a.lat, a.lng, b.lat, b.lng);
    if (cached) {
      // Project cache into the result shape — adds empty geometry since
      // the cache does not store geometry (see cache.ts).
      return {
        distanceKm: cached.distanceKm,
        durationSeconds: cached.durationSeconds,
        geometry: [],
        source: cached.source,
      };
    }

    for (const provider of this.providers) {
      try {
        const result = await provider.route(a, b);
        if (result) {
          setCachedLeg(a.lat, a.lng, b.lat, b.lng, result);
          return result;
        }
      } catch {
        // Providers should never throw, but if one does we still want to
        // try the next one in the chain.
      }
    }
    return null;
  }

  /**
   * Build the symmetric distance matrix for an N-point set.
   *
   * Returns `Record<"i,j", number>` with `i < j`. Same-point pairs
   * resolve to `0` without going through the network. Pairs the
   * provider chain cannot resolve resolve to `Infinity`.
   *
   * Concurrency is bounded at 5 workers (matches the legacy
   * `clientRouting.ts` pacing) so we don't slam OSRM's public API.
   */
  async buildDistanceMatrix(
    points: Point[],
    onProgress?: ProgressCallback,
  ): Promise<Record<string, number>> {
    const n = points.length;
    const totalPairs = (n * (n - 1)) / 2;
    const matrix: Record<string, number> = {};

    if (n < 2) return matrix;

    // Pre-seed the trivial cases (same point) so they count toward
    // progress without touching the network.
    const workPairs: Array<{ i: number; j: number; a: Point; b: Point }> = [];
    let geoapifyCount = 0;
    let osrmCount = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = points[i];
        const b = points[j];
        if (a && b && a.lat === b.lat && a.lng === b.lng) {
          matrix[`${i},${j}`] = 0;
        } else if (a && b) {
          workPairs.push({ i, j, a, b });
        }
      }
    }

    const totalReal = () => geoapifyCount + osrmCount;
    let unreachableCount = 0;
    let done = 0;
    const startTime = Date.now();

    const report = (): void => {
      if (!onProgress) return;
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = done / Math.max(elapsed, 0.1);
      onProgress({
        phase: 'matrix',
        stage:
          totalReal() > 0
            ? `Geoapify: ${geoapifyCount} · OSRM: ${osrmCount}`
            : 'Calculando distancias...',
        current: done,
        total: totalPairs,
        percent: totalPairs === 0 ? 100 : Math.round((done / totalPairs) * 100),
        etaSeconds: speed > 0 ? Math.round((totalPairs - done) / speed) : 999,
        geoapifyCount,
        osrmCount,
        unreachableCount,
      });
    };

    report();

    let idx = 0;

    const worker = async (): Promise<void> => {
      while (idx < workPairs.length) {
        const pair = workPairs[idx++];
        if (!pair) break;
        const key = `${pair.i},${pair.j}`;
        const result = await this.route(pair.a, pair.b);
        if (result && Number.isFinite(result.distanceKm)) {
          matrix[key] = result.distanceKm;
          if (result.source === 'geoapify') geoapifyCount++;
          else osrmCount++;
        } else {
          matrix[key] = Infinity;
          unreachableCount++;
        }
        done++;
        if (done % PROGRESS_EVERY === 0 || done === totalPairs) report();
      }
    };

    await Promise.all(Array.from({ length: MATRIX_CONCURRENCY }, () => worker()));
    report();

    return matrix;
  }

  /**
   * Build a cross-validated `ConsensusMatrix` from a pool of batch
   * providers + a per-pair fallback. The result carries per-pair
   * reliability so downstream consumers (the optimizer) can reject
   * low-confidence legs.
   *
   * `batchProviders` are run in parallel; the per-pair provider is
   * used as a tie-break for pairs the batches could not resolve.
   * Each per-pair call goes through `cache.ts` so re-runs on the
   * same point set are essentially free.
   *
   * The per-pair provider defaults to the lowest-priority member of
   * this service's chain (typically OSRM, since Geoapify is the
   * highest-priority tier). Callers that need a specific per-pair
   * provider can pass it explicitly.
   *
   * The sequential `route()` / `buildDistanceMatrix()` paths are
   * NOT used here — this is an additive opt-in that exists
   * alongside them. See
   * `openspec/changes/consensus-matrix/specs/consensus-matrix/spec.md`.
   */
  async buildConsensusMatrix(
    points: Point[],
    batchProviders: BatchRouteProvider[],
    perPairProvider?: RouteProvider,
    onProgress?: OnConsensusProgress,
  ): Promise<ConsensusMatrix> {
    const fallback =
      perPairProvider ??
      // Lowest-priority member of the chain is the OSRM-style
      // free fallback; pick the last element after the priority
      // sort we already do in the constructor.
      this.providers[this.providers.length - 1]!;
    const builder = new ConsensusBuilder(batchProviders, fallback, onProgress);
    return builder.build(points);
  }
}
