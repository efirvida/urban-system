/**
 * Geoapify route provider — calls the existing backend proxy
 * `POST /api/routing` so the `GEOAPIFY_API_KEY` env var stays server-side.
 *
 * Only returns success when the backend reports `source === "geoapify"`.
 * If the key is missing or the call falls through to OSRM/Haversine on
 * the server, this provider returns `null` and the `RoutingService` tries
 * the next provider (typically the public OSRM fallback).
 */

import type { Point, RouteLegResult, RouteProvider } from "../types";

interface ApiRoutingResponse {
  coordinates?: [number, number][];
  distance?: number;
  time?: number;
  source?: "geoapify" | "osrm" | "haversine";
}

const API_TIMEOUT_MS = 15000;

export class GeoapifyProvider implements RouteProvider {
  readonly name = "geoapify";
  readonly priority = 0;

  async route(a: Point, b: Point): Promise<RouteLegResult | null> {
    try {
      const res = await fetch("/api/routing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stops: [a, b] }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as ApiRoutingResponse;
      // The whole point of this provider: succeed ONLY when the backend
      // actually used Geoapify. Otherwise the OSRM provider re-does the
      // work — see design.md §Data Flow.
      if (data.source !== "geoapify") return null;
      if (typeof data.distance !== "number" || typeof data.time !== "number") {
        return null;
      }
      return {
        distanceKm: data.distance,
        durationSeconds: data.time,
        geometry: Array.isArray(data.coordinates) ? data.coordinates : [],
        source: this.name,
      };
    } catch {
      return null;
    }
  }
}
