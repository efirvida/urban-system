/**
 * Default optimizer set — registered in the order the UI renders them
 * and the registry tiebreaks by. Order matters:
 *
 *   0. CwOptimizer       — fast deterministic baseline, always runs.
 *   1. Nsga2Optimizer    — multi-objective GA, always runs.
 *   2. GeoapifyOptimizer — third-party Route Planner; only resolves when
 *                          `GEOAPIFY_API_KEY` is set, returns `null`
 *                          otherwise (graceful no-op).
 *
 * Adding a fourth algorithm is one new file in this directory and one
 * extra entry in `defaultOptimizers`.
 */

import { CwOptimizer } from "./cw";
import { Nsga2Optimizer } from "./nsga2";
import { GeoapifyOptimizer } from "./geoapify";
import type { Optimizer } from "../types";

export { CwOptimizer } from "./cw";
export { Nsga2Optimizer } from "./nsga2";
export { GeoapifyOptimizer } from "./geoapify";

export const defaultOptimizers: Optimizer[] = [
  new CwOptimizer(),
  new Nsga2Optimizer(),
  new GeoapifyOptimizer(),
];
