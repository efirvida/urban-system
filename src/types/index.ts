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
  constraintType: "hours" | "visits" | "capacity";
  constraintValue: number;
  avgSpeed: number; // km/h, default 60
  visitTime: number; // minutes per stop, default 30
}

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

/** Response from the optimization API */
export interface OptimizeResponse {
  days: DayRoute[];
  totalDistance: number;
  totalDays: number;
  totalLocations: number;
}

/** Error response */
export interface ApiError {
  error: string;
  details?: string;
}
