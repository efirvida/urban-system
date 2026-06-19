// ─── Locations ───────────────────────────────────────────────

import type { RoutingSourceExtended } from "@/utils/routing/types";

// Re-export so consumers can `import { RoutingSourceExtended } from "@/types"`.
export type { RoutingSourceExtended };

/** A single location to visit */
export interface Location {
  name: string;
  lat: number;
  lng: number;
}

// ─── File / Import ───────────────────────────────────────────

/** Raw data extracted from a spreadsheet — all columns, all rows */
export interface RawFileData {
  fileName: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

/** Column-to-field mapping chosen by the user */
export interface ColumnMapping {
  nameColumn: string;
  latColumn: string;
  lngColumn: string;
}

/** A single row after column mapping + validation */
export interface ValidatedRow {
  id: string;
  selected: boolean;
  name: string;
  lat: number | null;
  lng: number | null;
  /** Raw string values as they came from the file (for display / edit) */
  rawName: string;
  rawLat: string;
  rawLng: string;
  /** Validation */
  isValid: boolean;
  validationError?: string;
  /** Whether the user has manually edited any field */
  edited: boolean;
}

// ─── Config ──────────────────────────────────────────────────

/** User-configurable optimization parameters */
export interface Config {
  homeLat: number;
  homeLng: number;
  constraintType: "hours" | "visits" | "hours+visits";
  constraintValue: number;
  maxVisits?: number; // used when constraintType is "visits" or "hours+visits"
  avgSpeed: number; // km/h, default 60
  visitTime: number; // minutes per stop, default 30
  /**
   * PR 6 (real-roads-only): when true, the API builds and propagates a
   * `DistanceMatrix` (per-pair `MatrixEntry`) end-to-end. When false
   * (default) the API and optimizers fall back to the legacy
   * `Record<string, number>` shape — behavior is bit-identical to pre-PR-6.
   */
  useStrictMatrix?: boolean;
}

// ─── Distance matrix (PR 6) ──────────────────────────────────

/** Source of a single distance matrix entry. */
export type RoutingSource = "real" | "estimated" | "unreachable";

/**
 * Per-pair distance record. `distance` is in km; when `source` is
 * `"unreachable"` the value is `Infinity` so that `matGet` propagates
 * the missing key through the optimizer (rejects the candidate) instead
 * of poisoning `totalDist` with a `0` fallback.
 *
 * The shape is a single interface (not a discriminated union) so legacy
 * `Record<string, number>` consumers can opt in with a single
 * `entry.distance` lookup and read `entry.source` only when needed.
 */
export interface MatrixEntry {
  /** Distance in km (`Infinity` when `source === "unreachable"`). */
  distance: number;
  /** Per-pair source — distinguishes real roads from estimates at the type level. */
  source: RoutingSource;
}

/**
 * Distance matrix with per-pair source metadata.
 *
 * `key` is `"i,j"` with `i < j`. The matrix convention is:
 *   - 0      = home
 *   - 1..n   = POIs in array order
 *
 * Pairs that the pre-filter considers unreachable may be absent entirely
 * (callers MUST handle the `undefined` case the same as before PR 6).
 */
export type DistanceMatrix = Record<string, MatrixEntry>;

// ─── Results ─────────────────────────────────────────────────

/** A single stop within a day's route */
export interface Stop {
  sequence: number;
  name: string;
  lat: number;
  lng: number;
  distanceFromPrev: number; // km
  cumulativeDistance: number; // km from home start
  cumulativeTime: number; // hours from departure
  isHome: boolean;
}

/** One day's complete route: home → stops → home */
export interface DayRoute {
  day: number;
  stops: Stop[];
  totalDistance: number; // km (including return to home)
  totalTime: number; // hours
  totalStops: number; // locations visited (not counting home)
}

/**
 * A POI the API excluded from optimization because it has no real road
 * connection to home. Surfaces the POI to the caller (UI badge, "Try
 * again" CTA in PR 3) without losing information about the rejection.
 */
export interface UnreachablePoi {
  name: string;
  lat: number;
  lng: number;
  /**
   * Why the POI was filtered out.
   *   - "no_road_connection" — the routing provider had no real road
   *     from home (or to any neighbor) and the matrix was filled with
   *     a Haversine estimate.
   * Future values may distinguish island parcels, unmapped service
   * roads, or provider timeouts once PR 6 adds intra-day reachability.
   */
  reason: "no_road_connection" | string;
}

/** Response from the optimization API */
export interface OptimizeResponse {
  days: DayRoute[];
  totalDistance: number;
  totalDays: number;
  totalLocations: number;
  /**
   * One entry per registered optimizer, in registration order. A slot
   * is `null` when the optimizer was unavailable (missing API key),
   * failed (threw), or returned no result. The legacy `days` /
   * `totalDistance` / `totalDays` fields above always equal the BEST
   * non-null entry of this array — so a client that ignores `results`
   * sees no behavior change vs the pre-Strategy baseline.
   *
   * Additive — existing clients keep working.
   */
  results?: (OptimizerResult | null)[];
  /**
   * POIs the optimizer was asked to route but could not (no real road
   * to home). Always present when the API ran the pre-filter; empty
   * array means every POI was reachable. Additive — existing clients
   * ignore this field.
   */
  unreachable?: UnreachablePoi[];
  /**
   * PR 6 (real-roads-only): when `useStrictMatrix` is true, the API
   * builds a `DistanceMatrix` with per-pair source metadata and
   * surfaces it here for consumers that want type-safe access. Each
   * entry is a `MatrixEntry` with `{ distance, source }`. Legacy
   * callers that ignore this field see no behavior change.
   */
  strictMatrix?: DistanceMatrix;
  _meta?: {
    elapsedMs: number;
    osrmPairs: number;
    totalPairs: number;
    routingMode: "osrm" | "haversine" | "api" | "geoapify";
    /** Number of POIs excluded by the unreachable pre-filter. */
    unreachableCount?: number;
    /**
     * PR 6 (real-roads-only): when the request set `useStrictMatrix`,
     * the API echoes it back here so the frontend can correlate the
     * response shape with the requested mode.
     */
    useStrictMatrix?: boolean;
  };
}

/**
 * One algorithm's best solution, surfaced to the UI alongside the
 * legacy winner block. Mirrors the contract of
 * `src/utils/optimizer/types.ts` — kept in `types/index.ts` so the
 * frontend can import it from one place.
 */
export interface OptimizerResult {
  /** Stable id: "cw", "nsga2", "geoapify". */
  algorithm: string;
  /** Display label: "Clarke & Wright", "NSGA-II", "Geoapify Route Planner". */
  label: string;
  days: DayRoute[];
  totalDistance: number;
  totalDays: number;
  totalTime: number;
  /**
   * Consensus-matrix change: mean reliability of the legs this
   * optimizer used in its final solution, in `[0, 1]`. `undefined`
   * when the optimizer did not consume a `consensusMatrix`
   * (legacy path). See `routing-reliability` spec.
   */
  avgReliability?: number;
}

/** Error response */
export interface ApiError {
  error: string;
  details?: string;
}

// ─── NSGA-II ─────────────────────────────────────────────────

/** A single solution from the Pareto front */
export interface ParetoSolution {
  days: number;
  totalDistance: number;
  maxDayHours: number;
  /** Location indices per route (in visit order) */
  routes: number[][];
  /** Converted DayRoute[] for map display */
  dayRoutes: DayRoute[];
  routingLabel?: string;
}

/** Response when algorithm=nsga2 */
export interface NSGAResponse {
  algorithm: "nsga2";
  balanced: ParetoSolution;
  minDistance: ParetoSolution;
  minDuration: ParetoSolution;
  paretoFront: ParetoSolution[];
  totalEvaluations: number;
  _meta?: {
    elapsedMs: number;
    osrmPairs: number;
    totalPairs: number;
    routingMode: "osrm" | "haversine" | "api" | "geoapify";
  };
  _debug?: {
    frontSize: number;
    uniqueDays: number[];
  };
}

// ─── Consensus Matrix (consensus-matrix change) ─────────────

/**
 * One provider's vote on a single pair in a `ConsensusMatrix`.
 *
 * `distance` is the km value the provider returned, or `null` when
 * the provider reported the pair as unreachable. A `null` vote MUST
 * NOT be coerced to `0` — per `strict-matrix-contract`, silence
 * propagates as "no opinion" so the consensus can score agreement
 * without a false positive.
 *
 * `provider` matches the `BatchRouteProvider.name` (or
 * `RouteProvider.name` for the per-pair tie-break). The
 * `RoutingSourceExtended` union is wider than the actual set of
 * vote providers; `"unreachable"` is a valid `ConsensusEntry.source`
 * but never appears here.
 */
export interface ProviderVote {
  provider: RoutingSourceExtended;
  distance: number | null;
}

/**
 * Cross-validated per-pair distance produced by `ConsensusBuilder`.
 *
 * - `distance` is in km (`Infinity` when the pair resolved below
 *   `RELIABILITY_FLOOR` — per `strict-matrix-contract`, the
 *   optimizer MUST treat this as unreachable and reject the
 *   candidate).
 * - `reliability` is the fraction of providers whose distance fell
 *   within `CONSENSUS_TOLERANCE` of the median. Range `[0, 1]`.
 *   A reliability below `RELIABILITY_FLOOR` (0.34) forces
 *   `distance = Infinity`.
 * - `votes` is the per-provider round-trip: survives intact through
 *   `OptimizeParams` so the UI can surface "how confident was this
 *   leg" per pair.
 * - `source` is the winning provider's name, or `"unreachable"`
 *   when no provider contributed a reliable value.
 */
export interface ConsensusEntry {
  distance: number;
  reliability: number;
  votes: ProviderVote[];
  source: RoutingSourceExtended;
}

/**
 * Per-pair cross-validated distance matrix. Keys are `"i,j"` with
 * `i < j`, same convention as the legacy `Record<string, number>`
 * matrix. Additive — legacy matrices keep working unchanged.
 */
export type ConsensusMatrix = Record<string, ConsensusEntry>;

// ─── Route Editing ──────────────────────────────────────────

/** A single edit action captured for undo. */
export interface EditMutation {
  type: "move" | "remove" | "add";
  /** Display name of the POI this mutation acts on. */
  poiName: string;
  /** Day the POI was in BEFORE the mutation. 0 = unassigned pool. */
  fromDay: number;
  /** Day the POI ends up in AFTER the mutation. 0 = unassigned pool. */
  toDay: number;
  /** Snapshot of `editableDays` immediately before this mutation. */
  priorDays: DayRoute[];
  /** Snapshot of unassigned POIs immediately before this mutation. */
  priorUnassigned: Location[];
}

/** Edit-mode session: entry snapshot + undo stack + dirty flag. */
export interface EditSession {
  /** result.days at edit-mode entry — used by Discard and Apply restore. */
  snapshot: DayRoute[];
  /** POIs that are NOT in any day at session entry. */
  snapshotUnassigned: Location[];
  /** True if any mutation since session entry. */
  dirty: boolean;
  /** Cap 20 — oldest entry dropped on overflow. */
  undoStack: EditMutation[];
  redoStack: EditMutation[];
}
