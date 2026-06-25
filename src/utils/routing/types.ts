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

/**
 * Per-leg cache entry — same as `RouteLegResult` but without `geometry`.
 *
 * Geometry is excluded from the cache because:
 * 1. It's the primary consumer of localStorage quota (hundreds of coords per leg).
 * 2. The matrix builder only needs `distanceKm`.
 * 3. Map geometry is fetched separately by `fetchAllRouteGeometries()`.
 *
 * `timestamp` drives LRU eviction in `cache.ts`.
 */
export interface CachedLeg {
  /** Distance in kilometers. */
  distanceKm: number;
  /** Duration in seconds. */
  durationSeconds: number;
  /** Provider name (e.g. "geoapify", "osrm"). */
  source: string;
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
export type RouteSource =
  | 'geoapify'
  | 'geoapify-matrix'
  | 'ors'
  | 'ors-matrix'
  | 'osrm'
  | 'haversine';

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

/**
 * Routing source — per-pair, identifies which provider (or fallback)
 * contributed the final distance in a `ConsensusEntry`. The `"unreachable"`
 * member is reserved for entries that the consensus deemed below the
 * reliability floor; it never appears as a `ProviderVote.provider`.
 */
export type RoutingSourceExtended = 'geoapify-matrix' | 'ors-matrix' | 'osrm' | 'unreachable';

/**
 * Batch routing strategy — distinct from `RouteProvider` because batch
 * APIs (`/v1/routematrix`, `/v2/matrix/driving-car`) accept every point
 * in a single call and return the whole NxN matrix. `route(a, b)` is
 * meaningless here. `ConsensusBuilder` runs every `BatchRouteProvider`
 * in parallel and cross-references the result; the per-pair `OSRM`
 * provider is reserved as a tie-break for pairs the batches couldn't
 * resolve.
 *
 * Contract: `buildMatrix()` MUST NOT throw. On any failure (network,
 * parse, no road found) it returns an empty `Map` so the consensus
 * builder can still count that provider as a "null" vote.
 */
export interface BatchRouteProvider {
  /** Stable identifier — also used as the `ProviderVote.provider`. */
  readonly name: string;
  /** Lower = tried first. Negative values place a provider above batch=0. */
  readonly priority: number;
  /**
   * Build a full NxN distance matrix for the given point set. Keys are
   * `"i,j"` with `i < j`; values are distance in km or `null` for
   * unreachable pairs. The diagonal (`i,i`) is not required — only
   * off-diagonal pairs.
   */
  buildMatrix(points: Point[]): Promise<Map<string, number | null>>;
}

/** Convenience alias for the per-pair batch result. */
export type MatrixEntryMap = Map<string, number | null>;
