/**
 * Route geometry cache — stores encoded polylines keyed by sorted stop set.
 *
 * Why: fetchAllRouteGeometries() hits /api/routing for every day's route on
 * every results view. Caching the polyline in localStorage cuts repeated
 * views to zero API calls for the same stop set.
 *
 * Storage: encoded polyline (precision 5 ≈ 1cm) + source + timestamp.
 * An 80-coord route is ~120B encoded vs ~400B raw JSON.
 *
 * Eviction: timestamp-based LRU, 200-entry cap. Sweep runs on threshold
 * crossings only — steady-state cost is zero.
 */

import { encode, decode } from "@mapbox/polyline";
import type { RouteSource, Point } from "./types";

/** [lng, lat] coordinate tuple, matching GeoJSON/Leaflet conventions. */
export type LngLat = [number, number];

/** Result of a successful cache hit. */
export interface CachedGeometry {
  geometry: LngLat[];
  source: RouteSource;
}

interface GeometryCacheEntry {
  encoded: string;
  source: RouteSource;
  timestamp: number;
}

/** Swappable cache contract — future implementations (IndexedDB, server) can drop in. */
export interface RouteGeometryCache {
  get(stops: Point[]): Promise<CachedGeometry | null>;
  set(stops: Point[], geometry: LngLat[], source: RouteSource): Promise<void>;
  clear(): Promise<void>;
}

const GEO_PREFIX = "geo_";
const CACHE_CAP = 200;

/**
 * Build a stable cache key for a stop sequence.
 * Sorts stops by (lat, lng) and hashes precision-5 coords with djb2 → base 36.
 * Mirrors the locationsHash pattern in page.tsx.
 *
 * Exported so consumers can pre-compute keys for testing or instrumentation.
 */
export function routeGeometryKey(stops: Point[]): string {
  const sorted = [...stops].sort((a, b) => a.lat - b.lat || a.lng - b.lng);
  const str = sorted.map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join("|");
  let hash = 5381;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  return GEO_PREFIX + Math.abs(hash).toString(36);
}

class LocalStorageGeometryCache implements RouteGeometryCache {
  private key(stops: Point[]): string {
    return routeGeometryKey(stops);
  }

  async get(stops: Point[]): Promise<CachedGeometry | null> {
    try {
      const raw = localStorage.getItem(this.key(stops));
      if (!raw) return null;
      const entry: GeometryCacheEntry = JSON.parse(raw);
      return {
        geometry: decode(entry.encoded).map(([lat, lng]) => [lng, lat] as LngLat),
        source: entry.source,
      };
    } catch {
      return null;
    }
  }

  async set(stops: Point[], geometry: LngLat[], source: RouteSource): Promise<void> {
    try {
      const entry: GeometryCacheEntry = {
        encoded: encode(
          geometry.map(([lng, lat]) => [lat, lng] as [number, number]),
        ), // polyline uses [lat, lng]
        source,
        timestamp: Date.now(),
      };
      localStorage.setItem(this.key(stops), JSON.stringify(entry));
      this.evictIfNeeded();
    } catch {
      // silently skip on quota / serialization errors
    }
  }

  async clear(): Promise<void> {
    try {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(GEO_PREFIX)) toRemove.push(k);
      }
      for (const k of toRemove) localStorage.removeItem(k);
    } catch {
      // ignore
    }
  }

  private evictIfNeeded(): void {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(GEO_PREFIX)) keys.push(k);
      }
      if (keys.length <= CACHE_CAP) return;

      const entries = keys.map((k) => {
        try {
          const raw = localStorage.getItem(k);
          const p = raw ? JSON.parse(raw) : null;
          return { key: k, ts: p?.timestamp ?? 0 };
        } catch {
          return { key: k, ts: 0 };
        }
      });
      entries.sort((a, b) => a.ts - b.ts);
      const toDelete = entries.slice(0, entries.length - CACHE_CAP);
      for (const e of toDelete) localStorage.removeItem(e.key);
    } catch {
      // ignore
    }
  }
}

/** Singleton instance — used by fetchAllRouteGeometries() and available to consumers. */
export const geometryCache = new LocalStorageGeometryCache();
