/**
 * Pre-filter POIs with no real road connection to home.
 *
 * A POI is reachable when its home→POI matrix entry is `real` (or
 * `estimated` with distance below `TINY_DISTANCE_KM`). Unreachable
 * entries (`source: "unreachable"`, `Infinity`, or missing) are
 * bucketed with reason `"no_road_connection"` and returned alongside
 * the reachable list so the API can surface them to the UI.
 *
 * Always operates on a `DistanceMatrix` — the legacy
 * `Record<string, number>` path has been removed (system-improvements
 * change: `DistanceMatrix` is the standard contract end-to-end).
 *
 * See: openspec/changes/real-roads-only/spec.md §unreachable-poi-handling
 */

import { Location, UnreachablePoi, DistanceMatrix } from "@/types";
import { TINY_DISTANCE_KM } from "./constants";

export function filterUnreachable(
  locations: Location[],
  home: Location,
  matrix: DistanceMatrix
): { reachable: Location[]; unreachable: UnreachablePoi[] } {
  void home;

  const HOME_INDEX = 0;
  const reachable: Location[] = [];
  const unreachable: UnreachablePoi[] = [];

  for (let i = 0; i < locations.length; i++) {
    const poiIndex = i + 1;
    const key = `${HOME_INDEX},${poiIndex}`;
    const entry = matrix[key];
    if (entry && (entry.source === "real" || entry.distance < TINY_DISTANCE_KM)) {
      reachable.push(locations[i]);
    } else {
      unreachable.push({ ...locations[i], reason: "no_road_connection" });
    }
  }

  return { reachable, unreachable };
}
