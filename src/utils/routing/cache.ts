/**
 * Per-leg localStorage cache for routing results.
 *
 * Key format matches the legacy `routeLegKey` in `clientRouting.ts` so old
 * entries are invalidated gracefully (the old shape was a raw
 * `[number, number][]`; the new `getCachedLeg()` rejects it and the
 * caller re-fetches).
 *
 * Cap: 5000 entries. `localStorage` per origin is ~5MB; with ~250B per
 * enriched entry that gives us ~1.25MB — well under the cap, and 5000
 * covers the largest realistic matrix (≈ 50 POIs + home → 1275 pairs
 * plus some slack).
 *
 * LRU eviction is timestamp-based: when the cap is exceeded, the oldest
 * entries by `timestamp` are dropped. Sweep cost is O(n) but runs only
 * when the threshold is crossed, so the steady-state cost is zero.
 */

import type { CachedLeg, Point, RouteLegResult } from './types';

const RC_PREFIX = 'route_';
const CACHE_CAP = 2000; // smaller cap since entries are smaller (no geometry)

/**
 * Build a directional cache key for a leg (A → B).
 *
 * Directional on purpose: the geometry for A→B may differ from B→A on
 * one-way roads, so we key the way the pair was originally requested.
 * Matches the legacy `routeLegKey` in `clientRouting.ts` for backwards
 * compatibility with existing localStorage entries.
 */
export function routeLegKey(lat1: number, lng1: number, lat2: number, lng2: number): string {
  return RC_PREFIX + `${lat1.toFixed(5)},${lng1.toFixed(5)}|${lat2.toFixed(5)},${lng2.toFixed(5)}`;
}

/** Convenience wrapper accepting `Point` objects. */
export function routeLegKeyFromPoints(a: Point, b: Point): string {
  return routeLegKey(a.lat, a.lng, b.lat, b.lng);
}

/**
 * Read a cached leg, returning `null` for misses.
 *
 * Legacy entries (pre-refactor geometry-only arrays) are silently rejected,
 * triggering a re-fetch on the next matrix build.
 */
export function getCachedLeg(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): CachedLeg | null {
  try {
    const raw = localStorage.getItem(routeLegKey(lat1, lng1, lat2, lng2));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as CachedLeg).distanceKm !== 'number' ||
      typeof (parsed as CachedLeg).source !== 'string'
    ) {
      return null;
    }
    return parsed as CachedLeg;
  } catch {
    return null;
  }
}

/**
 * Write a leg result to the cache, stamping the current time.
 *
 * Only distance, duration, and source are persisted — geometry is excluded
 * to keep localStorage usage low. Map geometry is fetched separately by
 * `fetchAllRouteGeometries`.
 */
export function setCachedLeg(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  leg: RouteLegResult,
): void {
  try {
    const entry: CachedLeg = {
      distanceKm: leg.distanceKm,
      durationSeconds: leg.durationSeconds,
      source: leg.source,
      timestamp: Date.now(),
    };
    localStorage.setItem(routeLegKey(lat1, lng1, lat2, lng2), JSON.stringify(entry));
    evictIfNeeded();
  } catch {
    // Quota exceeded or storage disabled — silently skip; next call will
    // re-fetch and try again.
  }
}

/**
 * Drop the oldest entries (by `timestamp`) when the `route_` key count
 * exceeds `CACHE_CAP`. No-op under the cap.
 */
function evictIfNeeded(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(RC_PREFIX)) keys.push(k);
    }
    if (keys.length <= CACHE_CAP) return;

    const entries = keys.map((key) => {
      try {
        const raw = localStorage.getItem(key);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        const ts =
          parsed &&
          typeof parsed === 'object' &&
          typeof (parsed as CachedLeg).timestamp === 'number'
            ? (parsed as CachedLeg).timestamp
            : 0;
        return { key, timestamp: ts };
      } catch {
        return { key, timestamp: 0 };
      }
    });
    entries.sort((a, b) => a.timestamp - b.timestamp);
    const toDelete = entries.slice(0, entries.length - CACHE_CAP);
    for (const e of toDelete) {
      try {
        localStorage.removeItem(e.key);
      } catch {
        // Ignore — next sweep will retry.
      }
    }
  } catch {
    // localStorage unavailable — skip eviction.
  }
}
