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

/**
 * Consensus matrix: maximum relative spread between two providers'
 * distances that still counts as "agreement". 10% of the chosen
 * distance — pragmatic for urban/regional routes; tighter values
 * cause spurious disagreement on the lower end of the distribution.
 *
 * See: openspec/changes/consensus-matrix/specs/consensus-matrix/spec.md
 */
export const CONSENSUS_TOLERANCE = 0.10;

/**
 * Consensus matrix: minimum reliability (fraction of providers that
 * agree within `CONSENSUS_TOLERANCE`) for a pair to be considered
 * reachable. 0.34 ≈ 1/3 — at least 2 of 3 providers must agree. In
 * degraded 2-provider mode (no `ORS_API_KEY`) the floor is naturally
 * relaxed to 1/2 = 0.5.
 *
 * Pairs below this floor resolve to `Infinity` and the optimizer
 * rejects them, per `strict-matrix-contract`.
 *
 * See: openspec/changes/consensus-matrix/specs/routing-reliability/spec.md
 */
export const RELIABILITY_FLOOR = 0.34;
