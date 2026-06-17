/**
 * Routing distance thresholds (in kilometers).
 *
 * Centralized here so the "real road" vs "Haversine estimate" decision is
 * made identically across matrix builders, the API entry point, and the
 * pre-filter that excludes POIs with no road connection.
 *
 * Previously scattered as magic literals across the codebase:
 *   - 0.1  in clientRouting.ts:263, route.ts:87, route.ts:113
 *   - 0.01 in geoapifyMatrix.ts:219, route.ts:87, route.ts:113
 *
 * See: openspec/changes/real-roads-only/design.md §Constants
 */

/**
 * Threshold (km) separating a real road distance from a Haversine estimate.
 *
 * If `|real - haversine| > REAL_VS_ESTIMATED_KM`, the pair is considered to
 * have a real road; otherwise it is treated as an estimate (the routing
 * provider returned null and the matrix was filled with a straight-line
 * fallback). PR 1 uses this constant at the API entry point to detect
 * POIs with no real connection to home.
 */
export const REAL_VS_ESTIMATED_KM = 0.1;

/**
 * Pairs closer than this (km) are below road-network granularity; Haversine
 * is acceptable and the pair is treated as reachable (no real-road lookup
 * required for sub-50m hops). Mirrors the threshold in routing.ts:125 and
 * clientRouting.ts:259.
 */
export const TINY_DISTANCE_KM = 0.05;
