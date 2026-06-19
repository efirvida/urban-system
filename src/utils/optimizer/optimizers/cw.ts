/**
 * CwOptimizer — thin wrapper around the existing deterministic
 * `optimizeRoutes()` (NN + 2-opt giant tour + constraint split +
 * local search + GA post-refinement).
 *
 * Behavior is bit-identical to the pre-Strategy route.ts: the same
 * `optimizeRoutes()` call, the same `osrmPairs` / `totalPairs`
 * accounting. We only normalize the return shape to `OptimizerResult`
 * so the registry can collect it alongside NSGA-II and Geoapify.
 *
 * Consensus-matrix change: when `params.consensusMatrix` is present,
 * the consensus is overlaid on the legacy `matrix` and the result
 * is treated as the primary distance source. Legs whose consensus
 * reliability falls below `RELIABILITY_FLOOR` resolve to `Infinity`
 * and the optimizer rejects them, per `routing-reliability` spec.
 * The legacy `matrix` and `strictMatrix` remain untouched — the
 * overlay is a derived input to `optimizeRoutes`. The algorithm
 * core in `routerOptimizer.ts` / `geneticOptimizer.ts` is NOT
 * modified, satisfying the "solver core unchanged" constraint.
 */

import { RELIABILITY_FLOOR } from "@/utils/constants";
import { optimizeRoutes } from "@/utils/routerOptimizer";
import type {
  ConsensusMatrix,
  DayRoute,
  Location,
} from "@/types";
import type { Optimizer, OptimizeParams, OptimizerResult } from "../types";

export class CwOptimizer implements Optimizer {
  readonly name = "cw";
  readonly label = "Clarke & Wright";

  async optimize(params: OptimizeParams): Promise<OptimizerResult | null> {
    try {
      const nameToIndex = buildNameToIndex(params.home, params.locations);
      const { matrix: effectiveMatrix, hasConsensus } = overlayConsensus(
        params.matrix,
        params.consensusMatrix,
      );

      const result = await optimizeRoutes(
        params.locations,
        params.config,
        effectiveMatrix,
        params.strictMatrix,
      );

      const avgReliability =
        hasConsensus && params.consensusMatrix
          ? computeSolutionReliability(
              result.days,
              params.consensusMatrix,
              nameToIndex,
            )
          : undefined;

      return {
        algorithm: this.name,
        label: this.label,
        days: result.days,
        totalDistance: result.totalDistance,
        totalDays: result.days.length,
        totalTime: result.days.reduce((s, d) => s + d.totalTime, 0),
        avgReliability,
      };
    } catch (err) {
      console.warn(
        `[CwOptimizer] failed:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }
}

/** Build the home + locations → matrix-index map. */
function buildNameToIndex(
  home: Location,
  locations: Location[],
): Record<string, number> {
  const nameToIndex: Record<string, number> = { [home.name]: 0 };
  locations.forEach((loc, idx) => {
    nameToIndex[loc.name] = idx + 1;
  });
  return nameToIndex;
}

/**
 * Overlay the consensus onto the legacy matrix.
 *
 * - Pairs in the consensus that fall below `RELIABILITY_FLOOR`
 *   become `Infinity` (the optimizer rejects them).
 * - Pairs above the floor take the consensus distance — the
 *   consensus is the primary distance source per the spec.
 * - Pairs absent from the consensus keep the legacy value (or
 *   `Infinity` if absent there too).
 *
 * Returns the overlaid matrix and a flag indicating whether the
 * consensus was applied — `false` means the legacy path is in
 * effect and `avgReliability` should stay `undefined`.
 */
function overlayConsensus(
  matrix: Record<string, number>,
  consensusMatrix: ConsensusMatrix | undefined,
): { matrix: Record<string, number>; hasConsensus: boolean } {
  if (!consensusMatrix) {
    return { matrix, hasConsensus: false };
  }

  const overlaid: Record<string, number> = { ...matrix };
  for (const [key, entry] of Object.entries(consensusMatrix)) {
    if (entry.reliability < RELIABILITY_FLOOR) {
      overlaid[key] = Infinity;
    } else if (Number.isFinite(entry.distance)) {
      overlaid[key] = entry.distance;
    }
  }
  return { matrix: overlaid, hasConsensus: true };
}

/**
 * Mean reliability of the legs the optimizer actually used in its
 * final solution. Legs with `distance = Infinity` (rejected by the
 * consensus) are excluded — they did not contribute. Legs whose
 * stops have no name→index mapping are also excluded.
 */
function computeSolutionReliability(
  days: DayRoute[],
  consensusMatrix: ConsensusMatrix,
  nameToIndex: Record<string, number>,
): number | undefined {
  const reliabilities: number[] = [];
  for (const day of days) {
    for (let i = 0; i < day.stops.length - 1; i++) {
      const a = nameToIndex[day.stops[i]!.name];
      const b = nameToIndex[day.stops[i + 1]!.name];
      if (a === undefined || b === undefined) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const entry = consensusMatrix[key];
      if (entry && Number.isFinite(entry.distance)) {
        reliabilities.push(entry.reliability);
      }
    }
  }
  if (reliabilities.length === 0) return undefined;
  const sum = reliabilities.reduce((s, r) => s + r, 0);
  return sum / reliabilities.length;
}

