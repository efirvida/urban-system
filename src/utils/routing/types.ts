/**
 * Routing package — shared types for the per-leg routing pipeline.
 *
 * Strategy pattern: a `RouteProvider` is a pluggable strategy for getting
 * the real-road route between two points. `RoutingService` chains providers
 * in priority order; the first one that returns a result wins.
 *
 * See: openspec/changes/route-calculation-refactor/design.md
 */

/** A geographic point. Compatible with `Location` in `@/types`. */
export interface Point {
  lat: number;
  lng: number;
}

/** A successful real-road leg between two points. */
export interface RouteLegResult {
  /** Distance in kilometers. */
  distanceKm: number;
  /** Duration in seconds. */
  durationSeconds: number;
  /** Polyline as [lng, lat] pairs — GeoJSON convention. */
  geometry: [number, number][];
  /** Provider name (e.g. "geoapify", "osrm"). */
  source: string;
}

/** A `RouteLegResult` stamped with the time it was cached — drives LRU eviction. */
export interface CachedLeg extends RouteLegResult {
  /** `Date.now()` at write time. */
  timestamp: number;
}

/**
 * UI-side alias of the provider source name. The map uses this to choose
 * solid vs dashed styling: "haversine" estimates get dashed lines, real
 * roads get solid. Lives in the routing package because both
 * `clientRouting.ts` (matrix builder) and the API surface the same three
 * possible sources; previously duplicated as a local type in
 * `clientRouting.ts`.
 */
export type RouteSource = "geoapify" | "osrm" | "haversine";

/**
 * Pluggable routing strategy.
 *
 * Contract: `route()` MUST NOT throw. On any failure (network, parse, no
 * road found) it returns `null` so the `RoutingService` can fall through
 * to the next provider. The service is the only place that escalates an
 * unrecoverable failure.
 */
export interface RouteProvider {
  /** Stable identifier used in cache values and progress messages. */
  readonly name: string;
  /** Lower = tried first. Use 0 for the highest-priority provider. */
  readonly priority: number;
  route(a: Point, b: Point): Promise<RouteLegResult | null>;
}
