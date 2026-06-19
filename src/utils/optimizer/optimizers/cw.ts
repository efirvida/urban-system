/**
 * CwOptimizer — thin wrapper around the existing deterministic
 * `optimizeRoutes()` (NN + 2-opt giant tour + constraint split +
 * local search + GA post-refinement).
 *
 * Behavior is bit-identical to the pre-Strategy route.ts: the same
 * `optimizeRoutes()` call, the same `osrmPairs` / `totalPairs`
 * accounting. We only normalize the return shape to `OptimizerResult`
 * so the registry can collect it alongside NSGA-II and Geoapify.
 */

import { optimizeRoutes } from "@/utils/routerOptimizer";
import type { Optimizer, OptimizeParams, OptimizerResult } from "../types";

export class CwOptimizer implements Optimizer {
  readonly name = "cw";
  readonly label = "Clarke & Wright";

  async optimize(params: OptimizeParams): Promise<OptimizerResult | null> {
    try {
      const result = await optimizeRoutes(
        params.locations,
        params.config,
        params.matrix,
        params.strictMatrix,
      );
      return {
        algorithm: this.name,
        label: this.label,
        days: result.days,
        totalDistance: result.totalDistance,
        totalDays: result.days.length,
        totalTime: result.days.reduce((s, d) => s + d.totalTime, 0),
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
