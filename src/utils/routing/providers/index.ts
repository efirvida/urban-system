/**
 * Default provider chain — Geoapify first (real roads + per-leg accuracy,
 * server-side key), OSRM as the free fallback.
 *
 * `RoutingService` sorts by `priority` (ascending) before use, so the
 * order here is informational only. Keep priorities explicit on each
 * provider class to make the chain self-documenting.
 *
 * `batchProviders` are the matrix-API adapters consumed by
 * `ConsensusBuilder`. They are SEPARATE from `defaultProviders`
 * (per-leg adapters) — different transport granularity, different
 * interface (`BatchRouteProvider.buildMatrix` vs `RouteProvider.route`).
 * `ConsensusBuilder` runs every batch provider in parallel and uses
 * the per-pair `OSRMProvider` as a tie-break when all batches fail.
 */

import type { BatchRouteProvider, RouteProvider } from "../types";
import { GeoapifyProvider } from "./geoapify";
import { GeoapifyMatrixProvider } from "./geoapifyMatrix";
import { OrsMatrixProvider } from "./orsMatrix";
import { OSRMProvider } from "./osrm";

export { GeoapifyProvider } from "./geoapify";
export { GeoapifyMatrixProvider } from "./geoapifyMatrix";
export { OrsMatrixProvider } from "./orsMatrix";
export { OSRMProvider } from "./osrm";

export const defaultProviders: RouteProvider[] = [
  new GeoapifyProvider(),
  new OSRMProvider(),
];

/**
 * Batch matrix providers used by `ConsensusBuilder`.
 *
 * Order is informational; `ConsensusBuilder` sorts by `priority`.
 * `OrsMatrixProvider` is a no-op when `ORS_API_KEY` is missing — the
 * consensus then degrades to 2-provider (Geoapify + OSRM tie-break)
 * without an error.
 */
export const batchProviders: BatchRouteProvider[] = [
  new GeoapifyMatrixProvider(),
  new OrsMatrixProvider(),
];
