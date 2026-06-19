/**
 * Default optimizer set — registered in the order the UI renders them
 * and the registry tiebreaks by. Order matters:
 *
 *   0. CwOptimizer       — fast deterministic baseline, always runs.
 *   1. Nsga2Optimizer    — multi-objective GA, always runs.
 *   2. OrsOptimizer      — ORS Route Planner; only resolves when
 *                          `ORS_API_KEY` is set, returns `null`
 *                          otherwise (graceful no-op).
 *   3. GeoapifyOptimizer — Geoapify Route Planner (disabled: geoapify
 *                          key is for the matrix API, not the planner).
 *
 * Adding a new algorithm is one new file in this directory and one
 * extra entry in `defaultOptimizers`.
 */

import { CwOptimizer } from "./cw";
import { Nsga2Optimizer } from "./nsga2";
import { OrsOptimizer } from "./ors";
import type { Optimizer } from "../types";

export { CwOptimizer } from "./cw";
export { Nsga2Optimizer } from "./nsga2";
export { OrsOptimizer } from "./ors";

export const defaultOptimizers: Optimizer[] = [
  new CwOptimizer(),
  new Nsga2Optimizer(),
  // ORS Route Planner — desactivado: el endpoint /v2/optimization no está
  // disponible en la API pública de ORS (solo en instancias self-hosted).
  // Para activar: tener un servidor ORS propio y cambiar ORS_OPT_BASE.
  // new OrsOptimizer(),
  // Geoapify Route Planner — desactivado: calidad de rutas inferior a los solvers locales.
  // new GeoapifyOptimizer(),
];
