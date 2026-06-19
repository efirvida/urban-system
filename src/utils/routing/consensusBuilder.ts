/**
 * ConsensusBuilder — cross-validated distance matrix from a pool of
 * batch + per-pair routing providers.
 *
 * The builder runs every `BatchRouteProvider` in parallel (typically
 * GeoapifyMatrix and OrsMatrix), then for each pair cross-references
 * the responses:
 *
 *   1. Collect one `ProviderVote` per batch provider (`null` when the
 *      provider reported the pair as unreachable).
 *   2. If ALL batch providers returned `null` for a pair, fall back
 *      to the per-pair `RouteProvider` (OSRM) and add its vote —
 *      this is the design's "all batch null → try per-pair" rule.
 *      It keeps the call count manageable (OSRM is only hit for
 *      pairs the batches could not resolve) while still allowing
 *      the consensus to surface a single-provider value when one
 *      is available.
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

import {
  CONSENSUS_TOLERANCE,
  RELIABILITY_FLOOR,
} from "@/utils/constants";
import type {
  ConsensusEntry,
  ConsensusMatrix,
  ProviderVote,
  RoutingSourceExtended,
} from "@/types";
import type {
  BatchRouteProvider,
  Point,
  RouteProvider,
} from "./types";

const PER_PAIR_CONCURRENCY = 5;

export class ConsensusBuilder {
  constructor(
    private readonly batchProviders: BatchRouteProvider[],
    private readonly perPairProvider: RouteProvider,
  ) {}

  /**
   * Build a `ConsensusMatrix` for the given point set. Points are
   * indexed in the order they appear (0..n-1); the returned keys
   * follow the legacy `"i,j"` convention with `i < j`.
   */
  async build(points: Point[]): Promise<ConsensusMatrix> {
    const matrix: ConsensusMatrix = {};
    const n = points.length;
    if (n < 2) return matrix;

    // 1. Fire every batch provider in parallel. A provider that
    //    throws is treated identically to one that returned an
    //    empty map (no votes) — the spec scenario "One provider
    //    throws" requires this.
    const batchResults = await Promise.all(
      this.batchProviders.map((p) => this.safeBuild(p, points)),
    );

    // 2. Walk the upper triangle. For each pair, decide whether
    //    to call the per-pair provider (fallback path).
    const work: Array<{
      i: number;
      j: number;
      a: Point;
      b: Point;
      batchVotes: ProviderVote[];
      needsPerPair: boolean;
    }> = [];

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const key = `${i},${j}`;
        const batchVotes: ProviderVote[] = this.batchProviders.map(
          (provider, idx) => {
            const map = batchResults[idx];
            const dist = map?.get(key);
            return {
              provider: provider.name as RoutingSourceExtended,
              distance: typeof dist === "number" ? dist : null,
            };
          },
        );

        const needsPerPair = batchVotes.every((v) => v.distance === null);
        work.push({
          i,
          j,
          a: points[i]!,
          b: points[j]!,
          batchVotes,
          needsPerPair,
        });
      }
    }

    // 3. Run the per-pair provider with bounded concurrency for the
    //    pairs that need it. Pairs the batches resolved do not pay
    //    this cost.
    const perPairVotes = new Map<string, ProviderVote | null>();
    const pending = work.filter((w) => w.needsPerPair);
    if (pending.length > 0) {
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(PER_PAIR_CONCURRENCY, pending.length) },
        () => this.perPairWorker(pending, cursor, perPairVotes),
      );
      await Promise.all(workers);
    }

    // 4. Cross-reference and emit the final entries.
    for (const w of work) {
      const votes: ProviderVote[] = w.needsPerPair
        ? [
            ...w.batchVotes,
            perPairVotes.get(`${w.i},${w.j}`) ?? {
              provider: this.perPairProvider.name as RoutingSourceExtended,
              distance: null,
            },
          ]
        : w.batchVotes;
      matrix[`${w.i},${w.j}`] = this.crossReference(votes);
    }

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
   * Worker that drains the `pending` list starting at `cursor`,
   * calling the per-pair provider for each entry. Each call is
   * independent — failures land as `null` votes.
   */
  private async perPairWorker(
    pending: Array<{
      i: number;
      j: number;
      a: Point;
      b: Point;
    }>,
    startCursor: number,
    out: Map<string, ProviderVote | null>,
  ): Promise<void> {
    let cursor = startCursor;
    while (cursor < pending.length) {
      const job = pending[cursor]!;
      const result = await this.perPairProvider.route(job.a, job.b);
      out.set(`${job.i},${job.j}`, {
        provider: this.perPairProvider.name as RoutingSourceExtended,
        distance: result && Number.isFinite(result.distanceKm)
          ? result.distanceKm
          : null,
      });
      cursor += PER_PAIR_CONCURRENCY;
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
        typeof v.distance === "number" && Number.isFinite(v.distance),
    );

    if (finite.length === 0) {
      return {
        distance: Infinity,
        reliability: 0,
        votes,
        source: "unreachable",
      };
    }

    const median = pickMedian(finite.map((v) => v.distance));
    const tolerance = CONSENSUS_TOLERANCE * Math.max(median, 1e-9);
    const agreed = finite.filter(
      (v) => Math.abs(v.distance - median) <= tolerance,
    );

    const totalAttempted = votes.length;
    const reliability = agreed.length / totalAttempted;

    if (reliability < RELIABILITY_FLOOR) {
      return {
        distance: Infinity,
        reliability,
        votes,
        source: "unreachable",
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
