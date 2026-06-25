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

import type {
  ConsensusMatrix,
  DayRoute,
  Location,
  Config,
  DistanceMatrix,
} from "@/types";

/** Inputs every optimizer receives. */
export interface OptimizeParams {
  locations: Location[];
  home: Location;
  config: Config;
  /**
   * Per-pair `DistanceMatrix` (always present — required by the
   * standard contract). Optimizers read `entry.distance` and
   * `entry.source`; a missing or `unreachable` entry propagates
   * `Infinity` so the candidate is rejected naturally.
   */
  strictMatrix: DistanceMatrix;
  /**
   * Flat `Record<"i,j", km>` view of the matrix — kept for
   * optimizers that haven't migrated to per-pair entries yet
   * (e.g. the Geoapify optimizer). Always derived from the
   * `strictMatrix` by the API.
   */
  matrix: Record<string, number>;
  /**
   * Consensus matrix (per-pair cross-validated entry with reliability).
   * Additive — when absent, the optimizer behaves bit-identically to
   * the pre-change baseline. When present, optimizers read each pair's
   * `reliability` and reject any leg whose reliability falls below
   * `RELIABILITY_FLOOR` (per `routing-reliability` spec). The
   * `avgReliability` field on `OptimizerResult` aggregates the
   * per-leg reliability of the final solution.
   */
  consensusMatrix?: ConsensusMatrix;
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
  /**
   * Consensus-matrix change: mean reliability of the legs the
   * optimizer actually used in its final solution, in `[0, 1]`.
   * `undefined` when the optimizer did not consume a
   * `consensusMatrix` (legacy path) — surfacing `0` here would
   * be misleading. See `routing-reliability` spec.
   */
  avgReliability?: number;
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
