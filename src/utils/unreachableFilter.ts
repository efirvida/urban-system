/**
 * Pre-filter for POIs that have no real road connection to home.
 *
 * The optimizer must not see POIs reachable only via Haversine estimates
 * (e.g. a POI on an unmapped service road, an island parcel, an address
 * the routing provider refuses to route to). Including them yields
 * "optimal" routes that are impossible to drive — a defect that destroys
 * user trust in the solver.
 *
 * A POI is classified as unreachable when:
 *   1. The home→POI pair has no entry in the supplied matrix, OR
 *   2. The home→POI distance is within `REAL_VS_ESTIMATED_KM` of the
 *      Haversine reference (the routing provider failed and the matrix
 *      was filled with a straight-line estimate).
 *
 * Pairs under `TINY_DISTANCE_KM` (sub-50m) are always reachable — the
 * road network is not meaningful at that scale and Haversine is fine.
 *
 * Scope: home→POI only (per design §Architecture Decisions). Intra-day
 * reachability (A→B inside a day) is deferred to PR 6.
 *
 * See: openspec/changes/real-roads-only/spec.md §unreachable-poi-handling
 *      openspec/changes/real-roads-only/design.md §Data Flow (PR 1)
 */

import { Location, UnreachablePoi } from "@/types";
import { REAL_VS_ESTIMATED_KM, TINY_DISTANCE_KM } from "./constants";

/**
 * Partition `locations` into POIs the optimizer should visit and POIs to
 * exclude because they have no real road from home.
 *
 * @param locations    POIs (indexed 1..n in the matrix; home is index 0)
 * @param home         The depot / home location. The matrix convention
 *                     places home at index 0; the parameter is reserved
 *                     for future matrix conventions keyed by coordinates.
 * @param matrix       Precomputed "i,j" → km distance map. Home is index 0.
 * @param haversineRef Haversine reference matrix in the same shape
 *                     ("i,j" → km). Used to detect Haversine-fill entries.
 *
 * @returns `{ reachable, unreachable }`.
 *   - `reachable`   — `Location[]` preserved in input order; safe to feed
 *                     to the optimizer.
 *   - `unreachable` — `UnreachablePoi[]` (name + coords + reason) so the
 *                     API can surface them to the caller (UI badge, "Try
 *                     again" CTA in PR 3) without losing information.
 */
export function filterUnreachable(
  locations: Location[],
  home: Location,
  matrix: Record<string, number>,
  haversineRef: Record<string, number>
): { reachable: Location[]; unreachable: UnreachablePoi[] } {
  // `home` is reserved for future matrix conventions. The current
  // convention (buildHaversineMatrix) places home at index 0.
  void home;

  // Home is the sentinel index 0 in the matrix; POIs occupy 1..n.
  const HOME_INDEX = 0;

  const reachable: Location[] = [];
  const unreachable: UnreachablePoi[] = [];

  for (let i = 0; i < locations.length; i++) {
    const poiIndex = i + 1; // matrix index for this POI
    const key = `${HOME_INDEX},${poiIndex}`;
    const H = haversineRef[key];

    // ── Sub-50m pairs: Haversine is fine, no real road needed ──
    if (H !== undefined && H < TINY_DISTANCE_KM) {
      reachable.push(locations[i]);
      continue;
    }

    // ── Defensive: haversineRef is incomplete (caller bug) ──
    // Treat as unreachable to avoid silently passing un-classified POIs
    // through to the optimizer. The API builds haversineRef for every
    // pair, so this branch is unreachable in practice.
    if (H === undefined) {
      unreachable.push({ ...locations[i], reason: "no_road_connection" });
      continue;
    }

    const d = matrix[key];

    // ── Missing matrix entry → no road data → unreachable ──
    if (d === undefined) {
      unreachable.push({ ...locations[i], reason: "no_road_connection" });
      continue;
    }

    // ── Matrix value is essentially Haversine → provider returned null
    //    and the builder filled with a straight-line estimate → unreachable
    if (Math.abs(d - H) < REAL_VS_ESTIMATED_KM) {
      unreachable.push({ ...locations[i], reason: "no_road_connection" });
      continue;
    }

    // ── Real road distance present → reachable ──
    reachable.push(locations[i]);
  }

  return { reachable, unreachable };
}
