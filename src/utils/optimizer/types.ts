/**
 * Optimizer Strategy Pattern — shared contracts.
 *
 * Mirrors `src/utils/routing/types.ts` for the routing pipeline. Each
 * optimizer implementation (`CwOptimizer`, `Nsga2Optimizer`,
 * `GeoapifyOptimizer`, …) lives in `optimizers/` and is registered
 * with the `OptimizerRegistry`. The endpoint calls `registry.runAll()`
 * in parallel; the resulting per-algorithm `OptimizerResult`s ride back
 * to the UI inside `OptimizeResponse.results`.
 */

import type { DayRoute, Location, Config, DistanceMatrix } from "@/types";

/** Inputs every optimizer receives. */
export interface OptimizeParams {
  locations: Location[];
  home: Location;
  config: Config;
  /** Legacy `Record<"i,j", km>` matrix — always provided by the route. */
  matrix: Record<string, number>;
  /**
   * PR 6 strict matrix (per-pair `MatrixEntry`). When present, optimizers
   * MUST prefer it over the legacy `matrix` to honor the real-roads-only
   * contract.
   */
  strictMatrix?: DistanceMatrix;
}

/** A single algorithm's best solution, surfaced to the UI. */
export interface OptimizerResult {
  /** Stable id: "cw", "nsga2", "geoapify". Used as the React key. */
  algorithm: string;
  /** Display label: "Clarke & Wright", "NSGA-II", "Geoapify Route Planner". */
  label: string;
  days: DayRoute[];
  totalDistance: number;
  totalDays: number;
  totalTime: number;
}

/** Strategy interface — one implementation per algorithm. */
export interface Optimizer {
  readonly name: string;
  readonly label: string;
  /**
   * Returns the algorithm's best solution for `params`, or `null` if
   * the algorithm is unavailable (missing API key, credit exhaustion,
   * pre-condition not met, etc.). The registry preserves the slot
   * order and surfaces `null` slots as-is to the UI.
   */
  optimize(params: OptimizeParams): Promise<OptimizerResult | null>;
}
