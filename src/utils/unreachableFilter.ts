/**
 * Pre-filter POIs with no real road connection to home.
 * A POI is unreachable when its home→POI matrix entry is missing,
 * is Infinity, or has source "unreachable" in a DistanceMatrix.
 *
 * Accepts both `Record<string, number>` (checks Number.isFinite)
 * and `DistanceMatrix` (reads entry.source).
 *
 * See: openspec/changes/real-roads-only/spec.md §unreachable-poi-handling
 */

import { Location, UnreachablePoi, DistanceMatrix } from "@/types";
import { TINY_DISTANCE_KM } from "./constants";

export function filterUnreachable(
  locations: Location[],
  home: Location,
  matrix: Record<string, number> | DistanceMatrix
): { reachable: Location[]; unreachable: UnreachablePoi[] } {
  void home;

  const HOME_INDEX = 0;
  const reachable: Location[] = [];
  const unreachable: UnreachablePoi[] = [];

  const isStrict =
    Object.values(matrix).some(
      (v) => typeof v === "object" && v !== null && "source" in v
    );

  for (let i = 0; i < locations.length; i++) {
    const poiIndex = i + 1;
    const key = `${HOME_INDEX},${poiIndex}`;

    if (isStrict) {
      const dm = matrix as DistanceMatrix;
      const entry = dm[key];
      if (entry && (entry.source === "real" || entry.distance < TINY_DISTANCE_KM)) {
        reachable.push(locations[i]);
      } else {
        unreachable.push({ ...locations[i], reason: "no_road_connection" });
      }
    } else {
      const m = matrix as Record<string, number>;
      const d = m[key];
      if (d !== undefined && Number.isFinite(d)) {
        reachable.push(locations[i]);
      } else {
        unreachable.push({ ...locations[i], reason: "no_road_connection" });
      }
    }
  }

  return { reachable, unreachable };
}
