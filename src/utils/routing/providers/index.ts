/**
 * Default provider chain — Geoapify first (real roads + per-leg accuracy,
 * server-side key), OSRM as the free fallback.
 *
 * `RoutingService` sorts by `priority` (ascending) before use, so the
 * order here is informational only. Keep priorities explicit on each
 * provider class to make the chain self-documenting.
 */

import type { RouteProvider } from "../types";
import { GeoapifyProvider } from "./geoapify";
import { OSRMProvider } from "./osrm";

export { GeoapifyProvider } from "./geoapify";
export { OSRMProvider } from "./osrm";

export const defaultProviders: RouteProvider[] = [
  new GeoapifyProvider(),
  new OSRMProvider(),
];
