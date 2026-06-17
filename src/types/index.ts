// ─── Locations ───────────────────────────────────────────────

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
