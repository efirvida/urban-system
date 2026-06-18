/**
 * OSRM route provider — public `router.project-osrm.org` API, direct
 * browser call (no API key, no backend proxy).
 *
 * 5s per-call timeout. Returns `null` on any failure so the
 * `RoutingService` can fall through. The geometry is requested with
 * `overview=full&geometries=geojson` so the result is reusable both as
 * a distance value and as a polylines for the map.
 */

import type { Point, RouteLegResult, RouteProvider } from "../types";

const OSRM_TIMEOUT_MS = 5000;

export class OSRMProvider implements RouteProvider {
  readonly name = "osrm";
  readonly priority = 1;

  async route(a: Point, b: Point): Promise<RouteLegResult | null> {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${a.lng},${a.lat};${b.lng},${b.lat}` +
      `?overview=full&geometries=geojson&steps=false&alternatives=false`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const data: unknown = await res.json();
      if (
        !data ||
        typeof data !== "object" ||
        (data as { code?: string }).code !== "Ok" ||
        !Array.isArray((data as { routes?: unknown[] }).routes) ||
        (data as { routes: unknown[] }).routes.length === 0
      ) {
        return null;
      }

      const route = (data as { routes: { distance: number; duration: number; geometry?: { coordinates?: number[][] } }[] })
        .routes[0];
      const rawCoords = route.geometry?.coordinates ?? [];
      const geometry: [number, number][] = rawCoords
        .filter((c): c is number[] => Array.isArray(c) && c.length >= 2)
        .map((c) => [c[0], c[1]]);

      return {
        distanceKm: route.distance / 1000,
        durationSeconds: route.duration,
        geometry,
        source: this.name,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
