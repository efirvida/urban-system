/**
 * ConsensusBuilder — cross-validated distance matrix from a pool of
 * batch + per-pair routing providers.
 *
 * The builder runs every `BatchRouteProvider` in parallel (GeoapifyMatrix
 * and OrsMatrix), then runs the per-pair provider (OSRM) for EVERY pair.
 * All three votes are cross-referenced so each entry carries a reliability
 * score based on provider agreement.
 *
 *   1. Batch providers run in parallel → collect one `ProviderVote` per
 *      batch provider per pair (`null` when unreachable).
 *   2. OSRM runs for EVERY pair (bounded concurrency). Every pair gets at
 *      least 2 votes (batch) and up to 3 when OSRM also resolves it.
 *   3. Compute reliability as `agreed / totalAttempted`, where
 *      `agreed` = finite votes within `CONSENSUS_TOLERANCE` of
 *      the median and `totalAttempted` = number of votes in the
 *      array (including `null` ones).
 *   4. If `reliability < RELIABILITY_FLOOR` the entry's `distance`
 *      is `Infinity` (per `strict-matrix-contract`, the optimizer
 *      MUST reject the candidate) and the `source` is `"unreachable"`.
 *   5. Otherwise the chosen `distance` comes from the highest-tier
 *      (lowest `priority` value) agreeing provider.
 *
 * The result is a `ConsensusMatrix` keyed by `"i,j"` with `i < j`,
 * matching the legacy matrix convention (0 = home, 1..n = POIs).
 *
 * Reliability floor and tolerance are taken from `constants.ts` so
 * the policy is centralized across the consensus pipeline.
 *
 * See: openspec/changes/consensus-matrix/specs/consensus-matrix/spec.md
 */

import { CONSENSUS_TOLERANCE, RELIABILITY_FLOOR } from '@/utils/constants';
import type { ConsensusEntry, ConsensusMatrix, ProviderVote, RoutingSourceExtended } from '@/types';
import type { BatchRouteProvider, Point, RouteProvider } from './types';

const PER_PAIR_CONCURRENCY = 5;

/**
 * Progress event emitted during consensus matrix building.
 * Optional count fields let the UI show per-provider breakdowns.
 */
export interface ConsensusProgress {
  stage: string;
  current: number;
  total: number;
  detail: string;
  /** Pairs resolved by Geoapify Matrix API (finite). */
  geoapifyCount?: number;
  /** Pairs resolved by ORS Matrix API (finite). */
  orsCount?: number;
  /** Pairs resolved by OSRM per-pair (finite). */
  osrmCount?: number;
}

export type OnConsensusProgress = (p: ConsensusProgress) => void;

export class ConsensusBuilder {
  constructor(
    private readonly batchProviders: BatchRouteProvider[],
    private readonly perPairProvider: RouteProvider,
    private readonly onProgress?: OnConsensusProgress,
  ) {}

  /**
   * Build a `ConsensusMatrix` for the given point set. Points are
   * indexed in the order they appear (0..n-1); the returned keys
   * follow the legacy `"i,j"` convention with `i < j`.
   *
   * Every available provider runs for EVERY pair — Geoapify Matrix,
   * ORS Matrix (batch), and OSRM (per-pair). The three votes are
   * cross-referenced so each entry carries a reliability score based
   * on provider agreement.
   */
  async build(points: Point[]): Promise<ConsensusMatrix> {
    const matrix: ConsensusMatrix = {};
    const n = points.length;
    if (n < 2) return matrix;

    const totalPairs = (n * (n - 1)) / 2;

    // Track per-provider finite counts for progress reporting
    let geoapifyFinite = 0;
    let orsFinite = 0;
    let osrmFinite = 0;

    const emit = (
      stage: string,
      current: number,
      total: number,
      detail: string,
      extra?: { geoapifyCount?: number; orsCount?: number; osrmCount?: number },
    ) => this.onProgress?.({ stage, current, total, detail, ...extra });

    emit('providers', 0, totalPairs, 'Iniciando proveedores batch...');

    // 1. Fire every batch provider in parallel.
    const batchResults = await Promise.all(
      this.batchProviders.map((p) => this.safeBuild(p, points)),
    );

    for (let idx = 0; idx < this.batchProviders.length; idx++) {
      const p = this.batchProviders[idx]!;
      const r = batchResults[idx];
      const finiteCount = r ? [...r.values()].filter((v) => v !== null).length : 0;
      if (p.name === 'geoapify-matrix') geoapifyFinite = finiteCount;
      if (p.name === 'ors-matrix') orsFinite = finiteCount;
      emit(
        'providers',
        idx + 1,
        this.batchProviders.length,
        `${p.name}: ${finiteCount} pares resueltos`,
        { geoapifyCount: geoapifyFinite, orsCount: orsFinite },
      );
    }

    // 2. Determine which batch providers are "active" (returned a
    //    non-empty Map). A provider that returned an empty Map was
    //    unavailable (missing API key, all requests failed) and
    //    should not count toward the reliability denominator.
    const activeIndices = this.batchProviders
      .map((_, idx) => idx)
      .filter((idx) => batchResults[idx] && batchResults[idx]!.size > 0);

    // 3. Collect batch votes per pair, then run OSRM for ALL pairs.
    const allPairs: Array<{ i: number; j: number; a: Point; b: Point }> = [];
    const batchVotesByKey = new Map<string, ProviderVote[]>();

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const key = `${i},${j}`;
        const batchVotes: ProviderVote[] = activeIndices.map((idx) => {
          const map = batchResults[idx]!;
          const dist = map.get(key);
          return {
            provider: this.batchProviders[idx]!.name as RoutingSourceExtended,
            distance: typeof dist === 'number' ? dist : null,
          };
        });
        batchVotesByKey.set(key, batchVotes);
        allPairs.push({ i, j, a: points[i]!, b: points[j]! });
      }
    }

    // 4. Run OSRM (per-pair) for EVERY pair with bounded concurrency.
    const perPairVotes = new Map<string, ProviderVote | null>();
    if (allPairs.length > 0) {
      let osrmDone = 0;
      const numWorkers = Math.min(PER_PAIR_CONCURRENCY, allPairs.length);
      const workers = Array.from({ length: numWorkers }, (_, i) =>
        this.perPairWorker(allPairs, i, numWorkers, perPairVotes, (n, result) => {
          osrmDone += n;
          osrmFinite += result ? 1 : 0;
          emit('osrm', osrmDone, allPairs.length, `OSRM: ${osrmDone}/${allPairs.length} pares`, {
            osrmCount: osrmFinite,
            geoapifyCount: geoapifyFinite,
            orsCount: orsFinite,
          });
        }),
      );
      await Promise.all(workers);
    }

    emit('crossref', 0, allPairs.length, 'Cruzando referencias...', {
      geoapifyCount: geoapifyFinite,
      orsCount: orsFinite,
      osrmCount: osrmFinite,
    });

    // 5. Assemble votes (batch + OSRM) and cross-reference.
    for (let pi = 0; pi < allPairs.length; pi++) {
      const { i, j } = allPairs[pi]!;
      const key = `${i},${j}`;
      const batchVotes = batchVotesByKey.get(key) ?? [];
      const osrmVote = perPairVotes.get(key) ?? {
        provider: this.perPairProvider.name as RoutingSourceExtended,
        distance: null,
      };
      matrix[key] = this.crossReference([...batchVotes, osrmVote]);
      if (pi % 100 === 0 || pi === allPairs.length - 1) {
        emit(
          'crossref',
          pi + 1,
          allPairs.length,
          `Referencias cruzadas: ${pi + 1}/${allPairs.length}`,
        );
      }
    }

    emit('complete', totalPairs, totalPairs, 'Matriz de consenso completa', {
      geoapifyCount: geoapifyFinite,
      orsCount: orsFinite,
      osrmCount: osrmFinite,
    });
    return matrix;
  }

  /**
   * Run one provider, swallowing any error into an empty map. The
   * spec requires that a provider throw becomes a `null` vote on
   * every pair — the builder never sees the error.
   */
  private async safeBuild(
    provider: BatchRouteProvider,
    points: Point[],
  ): Promise<Map<string, number | null>> {
    try {
      return await provider.buildMatrix(points);
    } catch {
      return new Map();
    }
  }

  /**
   * Worker that drains a disjoint stride of the `pending` list.
   * Worker `i` processes indices `i`, `i + numWorkers`, `i + 2n`, ...
   * so all pairs are resolved exactly once across all workers.
   * Calls `onResolved(n, finite)` after each OSRM call so the builder can
   * report aggregate progress and track finite pair counts.
   */
  private async perPairWorker(
    pending: Array<{
      i: number;
      j: number;
      a: Point;
      b: Point;
    }>,
    workerIndex: number,
    numWorkers: number,
    out: Map<string, ProviderVote | null>,
    onResolved?: (n: number, finite: boolean) => void,
  ): Promise<void> {
    let cursor = workerIndex;
    while (cursor < pending.length) {
      const job = pending[cursor]!;
      const result = await this.perPairProvider.route(job.a, job.b);
      const finite = result !== null && Number.isFinite(result.distanceKm);
      out.set(`${job.i},${job.j}`, {
        provider: this.perPairProvider.name as RoutingSourceExtended,
        distance: finite ? result!.distanceKm : null,
      });
      cursor += numWorkers;
      onResolved?.(1, finite);
    }
  }

  /**
   * Cross-reference the votes for one pair. See the class-level
   * docstring for the full algorithm. The result is guaranteed
   * to satisfy the spec's `ConsensusEntry` contract:
   *
   *   - `distance` is finite when the pair resolved, else `Infinity`.
   *   - `reliability` is in `[0, 1]`.
   *   - `votes` is non-empty.
   *   - `source` matches the chosen distance, or `"unreachable"`.
   */
  private crossReference(votes: ProviderVote[]): ConsensusEntry {
    const finite = votes.filter(
      (v): v is ProviderVote & { distance: number } =>
        typeof v.distance === 'number' && Number.isFinite(v.distance),
    );

    if (finite.length === 0) {
      return {
        distance: Infinity,
        reliability: 0,
        votes,
        source: 'unreachable',
      };
    }

    const median = pickMedian(finite.map((v) => v.distance));
    const tolerance = CONSENSUS_TOLERANCE * Math.max(median, 1e-9);
    const agreed = finite.filter((v) => Math.abs(v.distance - median) <= tolerance);

    // Reliability = fraction of providers WITH DATA that agree within tolerance.
    // Null/unreachable votes mean "no data for this pair", not "disagreement".
    // If at least one provider has data, only count those; if none have data,
    // count all votes (reliability = 0).
    const totalAttempted = finite.length > 0 ? finite.length : votes.length;
    const reliability = agreed.length / totalAttempted;

    if (reliability < RELIABILITY_FLOOR) {
      return {
        distance: Infinity,
        reliability,
        votes,
        source: 'unreachable',
      };
    }

    // Pick the agreed vote from the highest-priority provider
    // (lowest `BatchRouteProvider.priority` / `RouteProvider.priority`).
    const priorityByName: Record<string, number> = {};
    for (const p of this.batchProviders) {
      priorityByName[p.name] = p.priority;
    }
    priorityByName[this.perPairProvider.name] = this.perPairProvider.priority;

    const ranked = [...agreed].sort(
      (a, b) =>
        (priorityByName[a.provider] ?? Number.POSITIVE_INFINITY) -
        (priorityByName[b.provider] ?? Number.POSITIVE_INFINITY),
    );
    const winner = ranked[0]!;

    return {
      distance: winner.distance,
      reliability,
      votes,
      source: winner.provider,
    };
  }
}

/**
 * Median of a (possibly unsorted) numeric array. Even-length
 * inputs return the lower-middle value — this matches the spec's
 * "within tolerance of median" semantics for an even vote count
 * (e.g. 2/2 or 1/2 with one out-of-tolerance outlier).
 */
function pickMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted[mid]!;
}
