/**
 * Client-side routing facade.
 *
 * Backwards-compatible wrapper around the new `RoutingService` pipeline
 * (PR 1 of this refactor). The legacy `buildDistanceMatrices()` API now
 * delegates to `RoutingService.buildDistanceMatrix()`. The legacy
 * geometry cache has been replaced by the per-leg routing cache in
 * `cache.ts` — the per-leg format is shared with `RoutingService.route()`
 * so a single leg resolved once satisfies both the matrix and the map
 * geometry.
 *
 * `MatrixProgress` and `ProgressCallback` are re-exported here from
 * `service.ts` for backward compatibility with `page.tsx` and
 * `OptimizeProgress.tsx`. `RouteSource` is re-exported from
 * `routing/types.ts` for `MapView.tsx` and `useLeafletRoutes.ts`.
 */

import { RoutingService } from "./routing/service";
import { defaultProviders } from "./routing/providers";
import { geometryCache } from "./routing/geometryCache";
import type { Point, RouteSource } from "./routing/types";

export type { MatrixProgress, ProgressCallback } from "./routing/service";
export type { RouteSource } from "./routing/types";

// ─── Public API ─────────────────────────────────────────────

/**
 * Fetch route geometry for a single stop sequence.
 *
 * Unchanged from the legacy implementation — the full-route polyline is
 * requested from the server (Geoapify → OSRM), and the map draws the
 * raw `coordinates` array. Used by the pre-optimize preview; the
 * post-optimize flow goes through `fetchAllRouteGeometries` so per-leg
 * results can be cached and shared with the matrix builder.
 */
export async function fetchRouteGeometry(
  stops: Array<{ lat: number; lng: number; provider?: string }>,
): Promise<[number, number][] | null> {
  if (stops.length < 2) return null;
  const preferredProvider = stops.find(s => s.provider)?.provider;
  try {
    const res = await fetch("/api/routing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stops,
        ...(preferredProvider ? { preferredSource: preferredProvider } : {}),
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { coordinates?: [number, number][] };
    return data.coordinates || null;
  } catch {
    return null;
  }
}

/**
 * Fetch geometries for all days. Uses the geometry cache (encoded polyline
 * in localStorage, ~200 bytes/entry) to avoid redundant API calls.
 *
 * Cache-first: on a cache hit, returns decoded polyline + stored source
 * without any network request. On miss, fetches from `/api/routing`,
 * stores the result in the cache, and returns.
 */
export async function fetchAllRouteGeometries(
  days: Array<{ day: number; stops: Array<{ lat: number; lng: number; isHome?: boolean; provider?: string }> }>,
): Promise<{
  geometries: Map<number, [number, number][]>;
  sources: Map<number, RouteSource>;
}> {
  const geometries = new Map<number, [number, number][]>();
  const sources = new Map<number, RouteSource>();

  for (const day of days) {
    const fullStops = [day.stops[0], ...day.stops.filter(s => !s.isHome), day.stops[0]];
    if (fullStops.length < 2) continue;

    // Cache-first: avoid the API call when geometry is already stored.
    const cached = await geometryCache.get(fullStops);
    if (cached) {
      geometries.set(day.day, cached.geometry);
      sources.set(day.day, cached.source as RouteSource);
      continue;
    }

    // Cache miss → fetch from API. Pass preferred provider from consensus.
    const preferredProvider = day.stops.find(s => !s.isHome && s.provider)?.provider;

    let routeCoords: [number, number][] | null = null;
    let apiSource: RouteSource = "haversine";

    try {
      const res = await fetch("/api/routing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stops: fullStops,
          ...(preferredProvider ? { preferredSource: preferredProvider } : {}),
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          coordinates?: [number, number][];
          source?: RouteSource;
        };
        routeCoords = data.coordinates || null;
        if (data.source === "geoapify" || data.source === "ors" || data.source === "osrm" || data.source === "haversine") {
          apiSource = data.source;
        }
      }
    } catch {
      // Network error — skip this day's geometry.
    }

    if (routeCoords && routeCoords.length > 0) {
      await geometryCache.set(fullStops, routeCoords, apiSource);
      geometries.set(day.day, routeCoords);
      sources.set(day.day, apiSource);
    }
  }

  return { geometries, sources };
}

// ─── Main ───────────────────────────────────────────────────

/**
 * Backwards-compatible matrix builder. Delegates the per-pair work to
 * `RoutingService` so the routing cache (now shared with
 * `fetchAllRouteGeometries`) is the single source of truth for legs.
 *
 * Public signature preserved: returns a `Map<string, number>` so any
 * existing consumer can keep using the same iteration pattern. The
 * `durationMatrix` field is still optional and currently `undefined` —
 * the new pipeline records duration in the cache but does not yet
 * surface it in the public matrix.
 */
export async function buildDistanceMatrices(
  homeLat: number,
  homeLng: number,
  locations: Array<{ lat: number; lng: number }>,
  onProgress: (p: import("./routing/service").MatrixProgress) => void,
): Promise<{
  osrmMatrix: Map<string, number>;
  durationMatrix?: Map<string, number>;
}> {
  const service = new RoutingService(defaultProviders);
  const all: Point[] = [{ lat: homeLat, lng: homeLng }, ...locations];
  const record = await service.buildDistanceMatrix(all, onProgress);

  const osrmMatrix = new Map<string, number>();
  for (const [key, value] of Object.entries(record)) {
    osrmMatrix.set(key, value);
  }
  return { osrmMatrix };
}


