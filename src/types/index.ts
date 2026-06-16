/** A single location to visit */
export interface Location {
  name: string;
  lat: number;
  lng: number;
}

/** User-configurable optimization parameters */
export interface Config {
  homeLat: number;
  homeLng: number;
  constraintType: "hours" | "visits" | "capacity";
  constraintValue: number;
  avgSpeed: number; // km/h, default 60
  visitTime: number; // minutes per stop, default 30
}

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

/** Parsed row from the .ods file */
export interface OdsRow {
  Nombre: string;
  Latitud: number;
  Longitud: number;
}

/** Error response */
export interface ApiError {
  error: string;
  details?: string;
}

/** Loading state for the optimize button */
export type LoadingState = "idle" | "loading" | "success" | "error";
