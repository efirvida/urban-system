// Shared types for the routing module.
// RouteSource is re-exported (type-only) from clientRouting.ts so the
// routing sub-modules stay self-contained without a runtime cycle.
import type { RouteSource } from "../clientRouting";

export type { RouteSource };

/** A waypoint with lat/lng — used for cache key derivation. */
export interface Point {
  lat: number;
  lng: number;
}
