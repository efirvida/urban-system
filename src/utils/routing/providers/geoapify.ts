/**
 * Server-side route provider — calls `POST /api/routing` so the
 * `GEOAPIFY_API_KEY` env var stays server-side.
 *
 * The backend tries Geoapify first, falls back to OSRM if Geoapify
 * fails (no credits, timeout, unmapped area), and returns `"haversine"`
 * only when neither provider could find a real road.
 *
 * This provider accepts any real-road result from the server
 * (source: "geoapify" OR "osrm"). Only rejects when the server itself
 * found no route (source: "haversine"). The OSRM client-side provider
 * is a true last resort — it only fires when the backend stack
 * (Geoapify → server-side OSRM) failed entirely.
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
      // Accept ANY real-road result from the server. When Geoapify
      // credits are exhausted the backend falls to OSRM automatically;
      // rejecting that would force the client-side OSRM provider to
      // re-do the same work, doubling latency.
      if (data.source === "haversine") return null;
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
