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
 */

import { runNSGA2 } from "@/utils/nsga2";
import type { Optimizer, OptimizeParams, OptimizerResult } from "../types";

export class Nsga2Optimizer implements Optimizer {
  readonly name = "nsga2";
  readonly label = "NSGA-II";

  async optimize(params: OptimizeParams): Promise<OptimizerResult | null> {
    try {
      const timeoutPromise = new Promise<null>((r) =>
        setTimeout(() => r(null), 30000),
      );
      const result = await Promise.race([
        runNSGA2(
          params.locations,
          params.home,
          params.config,
          params.matrix,
          params.strictMatrix,
        ),
        timeoutPromise,
      ]);
      if (!result) {
        console.warn(`[Nsga2Optimizer] timed out after 30s`);
        return null;
      }
      const best = result.minDistance;
      return {
        algorithm: this.name,
        label: this.label,
        days: best.dayRoutes,
        totalDistance: best.totalDistance,
        totalDays: best.days,
        totalTime: best.dayRoutes.reduce(
          (s: number, d) => s + d.totalTime,
          0,
        ),
      };
    } catch (err) {
      console.warn(
        `[Nsga2Optimizer] failed:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }
}
