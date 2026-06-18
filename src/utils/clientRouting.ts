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
import { getCachedLeg, setCachedLeg } from "./routing/cache";
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
  stops: Array<{ lat: number; lng: number }>,
): Promise<[number, number][] | null> {
  if (stops.length < 2) return null;
  try {
    const res = await fetch("/api/routing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stops }),
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
 * Fetch geometries for all days, sharing the routing cache with the
 * matrix builder. Per-leg lookups short-circuit the API when a
 * previously-resolved leg is still cached; on a fresh API call, each
 * leg is split out of the full polyline and persisted to the cache so
 * the next matrix build can reuse the geometry.
 */
export async function fetchAllRouteGeometries(
  days: Array<{ day: number; stops: Array<{ lat: number; lng: number; isHome?: boolean }> }>,
): Promise<{
  geometries: Map<number, [number, number][]>;
  sources: Map<number, RouteSource>;
}> {
  const geometries = new Map<number, [number, number][]>();
  const sources = new Map<number, RouteSource>();

  for (const day of days) {
    const fullStops = [day.stops[0], ...day.stops.filter(s => !s.isHome), day.stops[0]];
    if (fullStops.length < 2) continue;

    // Snapshot the cached leg per pair. Each entry is a clone because
    // getCachedLeg returns the SAME array reference; the stitching
    // loop mutates with `shift()` to drop the duplicate junction.
    const legsCached: Array<[number, number][] | null> = [];
    let allCached = true;
    for (let i = 0; i < fullStops.length - 1; i++) {
      const a = fullStops[i];
      const b = fullStops[i + 1];
      const cached = getCachedLeg(a.lat, a.lng, b.lat, b.lng);
      if (cached && cached.geometry.length > 0) {
        legsCached.push([...cached.geometry]);
      } else {
        legsCached.push(null);
        allCached = false;
      }
    }

    if (allCached) {
      // Stitch the per-leg caches into a day route. The per-leg cache
      // no longer remembers which provider produced it, so we
      // conservatively report "haversine" — the map will dash these
      // lines. That matches the pre-refactor behaviour.
      const stitched: [number, number][] = [];
      for (const leg of legsCached) {
        if (!leg) continue;
        if (stitched.length > 0 && leg.length > 0) leg.shift();
        stitched.push(...leg);
      }
      if (stitched.length > 0) {
        geometries.set(day.day, stitched);
        sources.set(day.day, "haversine");
      }
      continue;
    }

    // Cache miss → fetch the full route. The server returns per-leg
    // distance/time so we can persist the enriched cache entry without
    // resorting to a 0/durationSeconds sentinel.
    let routeCoords: [number, number][] | null = null;
    let perLegDistances: number[] = [];
    let perLegTimes: number[] = [];
    let apiSource: RouteSource = "haversine";

    try {
      const res = await fetch("/api/routing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stops: fullStops }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          coordinates?: [number, number][];
          legs?: Array<{ distance: number; time: number }>;
          source?: RouteSource;
        };
        routeCoords = data.coordinates || null;
        perLegDistances = (data.legs || []).map(l => l.distance);
        perLegTimes = (data.legs || []).map(l => l.time);
        if (data.source === "geoapify" || data.source === "osrm" || data.source === "haversine") {
          apiSource = data.source;
        }
      }
    } catch {
      // Network error — fall through to per-leg cache salvage below.
    }

    if (!routeCoords) {
      // Salvage whatever legs the cache still has. Mark as "haversine"
      // since we have no way to know the original provider.
      const salvage: [number, number][] = [];
      let hasAny = false;
      for (let i = 0; i < fullStops.length - 1; i++) {
        const a = fullStops[i];
        const b = fullStops[i + 1];
        const cached = getCachedLeg(a.lat, a.lng, b.lat, b.lng);
        if (cached && cached.geometry.length > 0) {
          const clone = [...cached.geometry];
          if (salvage.length > 0 && clone.length > 0) clone.shift();
          salvage.push(...clone);
          hasAny = true;
        }
      }
      if (hasAny) {
        geometries.set(day.day, salvage);
        sources.set(day.day, "haversine");
      }
      continue;
    }

    // Split the full polyline into per-leg slices and persist them to
    // the routing cache. Use the server-reported per-leg distance/time
    // when available; fall back to the polyline length (Haversine sum)
    // for legs the server did not break out (e.g. 2-stop requests).
    for (let i = 0; i < fullStops.length - 1; i++) {
      const a = fullStops[i];
      const b = fullStops[i + 1];
      if (getCachedLeg(a.lat, a.lng, b.lat, b.lng)) continue;

      const startIdx = i === 0 ? 0 : findClosestIdx(routeCoords, a.lng, a.lat);
      const endIdx = i === fullStops.length - 2
        ? routeCoords.length - 1
        : findClosestIdx(routeCoords, b.lng, b.lat);
      const legCoords = routeCoords.slice(
        Math.min(startIdx, endIdx),
        Math.max(startIdx, endIdx) + 1,
      );
      if (legCoords.length === 0) continue;

      const distanceKm = perLegDistances[i] ?? polylineLengthKm(legCoords);
      const durationSeconds = perLegTimes[i] ?? 0;
      setCachedLeg(a.lat, a.lng, b.lat, b.lng, {
        distanceKm,
        durationSeconds,
        geometry: legCoords,
        source: apiSource,
      });
    }

    // Rebuild the day route from the (now complete) cache. Re-read
    // because we just populated the missing legs.
    const stitched: [number, number][] = [];
    for (let i = 0; i < fullStops.length - 1; i++) {
      const a = fullStops[i];
      const b = fullStops[i + 1];
      const leg = getCachedLeg(a.lat, a.lng, b.lat, b.lng);
      if (!leg || leg.geometry.length === 0) continue;
      const clone = [...leg.geometry];
      if (stitched.length > 0 && clone.length > 0) clone.shift();
      stitched.push(...clone);
    }

    if (stitched.length > 0) {
      geometries.set(day.day, stitched);
      // Trust the source the server reported. Could be "geoapify",
      // "osrm" or "haversine" depending on backend priority.
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

// ─── Helpers (geometry-only, not network) ────────────────────

/** Find the polyline index closest to a given waypoint. */
function findClosestIdx(
  coords: [number, number][],
  lng: number,
  lat: number,
): number {
  let minD = Infinity;
  let minI = 0;
  for (let i = 0; i < coords.length; i++) {
    const d = Math.abs(coords[i][0] - lng) + Math.abs(coords[i][1] - lat);
    if (d < minD) {
      minD = d;
      minI = i;
    }
  }
  return minI;
}

/**
 * Approximate a polyline's road distance with the sum of Haversine
 * distances between consecutive points. Used as a fallback when the
 * server only returns the total distance (e.g. 2-stop request) and we
 * still need a per-leg value to persist to the cache. Not used to
 * decide reachability — that lives in `RoutingService`.
 */
function polylineLengthKm(coords: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];
    total += haversineKm(lat1, lng1, lat2, lng2);
  }
  return Math.round(total * 100) / 100;
}

/** Great-circle distance in km between two lat/lng points. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
