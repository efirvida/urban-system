/**
 * Nsga2Optimizer — thin wrapper around the existing `runNSGA2()`.
 *
 * We pick `minDistance` (lowest total km across the Pareto front) as
 * the canonical result to keep the algorithm's "best" consistent with
 * the `CwOptimizer` selection rule. The 30s ceiling matches the
 * pre-Strategy timeout in the route handler.
 *
 * NSGA-II's `minDistance` shape already carries the full `DayRoute[]`,
 * so normalization is a direct projection.
 *
 * Consensus-matrix change: same overlay strategy as `CwOptimizer`.
 * When `params.consensusMatrix` is present, the consensus is overlaid
 * on the legacy `matrix` and `runNSGA2` reads the result. Low-reliability
 * legs become `Infinity` and the algorithm rejects them. The
 * `runNSGA2` core in `src/utils/nsga2.ts` is NOT modified, satisfying
 * the "solver core unchanged" constraint from the
 * `routing-reliability` spec.
 */

import { RELIABILITY_FLOOR } from '@/utils/constants';
import { runNSGA2 } from '@/utils/nsga2';
import type { ConsensusMatrix, DayRoute, Location } from '@/types';
import type { Optimizer, OptimizeParams, OptimizerResult } from '../types';

export class Nsga2Optimizer implements Optimizer {
  readonly name = 'nsga2';
  readonly label = 'NSGA-II';

  async optimize(params: OptimizeParams): Promise<OptimizerResult | null> {
    try {
      const nameToIndex = buildNameToIndex(params.home, params.locations);
      const { matrix: effectiveMatrix, hasConsensus } = overlayConsensus(
        params.matrix,
        params.consensusMatrix,
      );

      const timeoutPromise = new Promise<null>((r) => setTimeout(() => r(null), 30000));
      const result = await Promise.race([
        runNSGA2(
          params.locations,
          params.home,
          params.config,
          effectiveMatrix,
          params.strictMatrix,
        ),
        timeoutPromise,
      ]);
      if (!result) {
        console.warn(`[Nsga2Optimizer] timed out after 30s`);
        return null;
      }
      const best = result.minDistance;

      const avgReliability =
        hasConsensus && params.consensusMatrix
          ? computeSolutionReliability(best.dayRoutes, params.consensusMatrix, nameToIndex)
          : undefined;

      return {
        algorithm: this.name,
        label: this.label,
        days: best.dayRoutes,
        totalDistance: best.totalDistance,
        totalDays: best.days,
        totalTime: best.dayRoutes.reduce((s: number, d) => s + d.totalTime, 0),
        avgReliability,
      };
    } catch (err) {
      console.warn(`[Nsga2Optimizer] failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  }
}

function buildNameToIndex(home: Location, locations: Location[]): Record<string, number> {
  const nameToIndex: Record<string, number> = { [home.name]: 0 };
  locations.forEach((loc, idx) => {
    nameToIndex[loc.name] = idx + 1;
  });
  return nameToIndex;
}

/**
 * Overlay the consensus onto the legacy matrix — see `cw.ts` for the
 * full contract. Pairs in the consensus that fall below
 * `RELIABILITY_FLOOR` become `Infinity`; pairs above the floor take
 * the consensus distance; pairs absent from the consensus keep the
 * legacy value.
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
