/**
 * Pre-filter for POIs that have no real road connection to home.
 *
 * The optimizer must not see POIs reachable only via Haversine estimates
 * (e.g. a POI on an unmapped service road, an island parcel, an address
 * the routing provider refuses to route to). Including them yields
 * "optimal" routes that are impossible to drive — a defect that destroys
 * user trust in the solver.
 *
 * Two overloads are exported:
 *
 *   1. **Legacy** (`matrix: Record<string, number>`) — used when
 *      `useStrictMatrix` is false (default). Classifies a POI as
 *      unreachable when its home→POI distance is missing from the
 *      matrix, or matches the Haversine reference within
 *      `REAL_VS_ESTIMATED_KM` (the routing provider returned null and
 *      the matrix was filled with a straight-line estimate).
 *
 *   2. **Strict** (`distanceMatrix: DistanceMatrix`) — used when
 *      `useStrictMatrix` is true (PR 6). Reads `entry.source` directly
 *      and never needs the haversineRef comparison. A POI is reachable
 *      iff its home→POI entry has `source: "real"`. Sub-50m pairs are
 *      always reachable (per the existing constant — Haversine is fine
 *      at that scale).
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

import { Location, UnreachablePoi, DistanceMatrix } from "@/types";
import { REAL_VS_ESTIMATED_KM, TINY_DISTANCE_KM } from "./constants";

// ─── Public API (overloaded) ─────────────────────────────────

/**
 * Legacy overload — operates on `Record<string, number>` plus a
 * Haversine reference. Use when `useStrictMatrix` is false.
 */
export function filterUnreachable(
  locations: Location[],
  home: Location,
  matrix: Record<string, number>,
  haversineRef: Record<string, number>
): { reachable: Location[]; unreachable: UnreachablePoi[] };

/**
 * Strict overload (PR 6) — operates on `DistanceMatrix`. Reads the
 * per-pair `source` field directly. No Haversine reference needed.
 */
export function filterUnreachable(
  locations: Location[],
  home: Location,
  distanceMatrix: DistanceMatrix
): { reachable: Location[]; unreachable: UnreachablePoi[] };

/**
 * Implementation — selects the classification path based on the shape
 * of the third argument at runtime (TypeScript picks the overload at
 * compile time, so the runtime check is a safety net for callers that
 * forward generic `Record<string, number> | DistanceMatrix` values).
 */
export function filterUnreachable(
  locations: Location[],
  home: Location,
  matrixOrDistance: Record<string, number> | DistanceMatrix,
  haversineRef?: Record<string, number>
): { reachable: Location[]; unreachable: UnreachablePoi[] } {
  // `home` is reserved for future matrix conventions. The current
  // convention (buildHaversineMatrix) places home at index 0.
  void home;

  // Home is the sentinel index 0 in the matrix; POIs occupy 1..n.
  const HOME_INDEX = 0;

  // Detect the strict path by sampling one value's shape. The strict
  // overload always supplies a third argument that is a `DistanceMatrix`
  // (an object whose values are `MatrixEntry` objects with a `.source`
  // field). The legacy path supplies a `Record<string, number>` and a
  // `haversineRef` fourth argument.
  const isStrict =
    haversineRef === undefined &&
    Object.values(matrixOrDistance).some(
      (v) => typeof v === "object" && v !== null && "source" in v
    );

  const reachable: Location[] = [];
  const unreachable: UnreachablePoi[] = [];

  for (let i = 0; i < locations.length; i++) {
    const poiIndex = i + 1; // matrix index for this POI
    const key = `${HOME_INDEX},${poiIndex}`;

    if (isStrict) {
      // ── Strict path: read MatrixEntry.source directly ──
      const dm = matrixOrDistance as DistanceMatrix;
      const entry = dm[key];

      if (entry && entry.source === "real") {
        reachable.push(locations[i]);
      } else if (entry && entry.distance < TINY_DISTANCE_KM) {
        // Sub-50m pairs: Haversine is fine, treat as reachable even
        // when the entry is tagged "estimated" by the builder.
        reachable.push(locations[i]);
      } else {
        // Missing key, tagged "estimated", or tagged "unreachable" →
        // exclude from optimization.
        unreachable.push({ ...locations[i], reason: "no_road_connection" });
      }
      continue;
    }

    // ── Legacy path: compare matrix value to Haversine ref ──
    const matrix = matrixOrDistance as Record<string, number>;
    const H = haversineRef![key];

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
