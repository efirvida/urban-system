import { haversineDistance } from "./haversine";
import { RoutingSource } from "@/types";
import { REAL_VS_ESTIMATED_KM, TINY_DISTANCE_KM } from "./constants";

// ─── Types ───────────────────────────────────────────────────

export interface RoutingProvider {
  name: string;
  distance(lat1: number, lng1: number, lat2: number, lng2: number): Promise<number>;
}

// ─── Simple LRU cache ────────────────────────────────────────

class LRUCache {
  private max: number;
  private cache = new Map<string, number>();

  constructor(max = 2000) {
    this.max = max;
  }

  private key(lat1: number, lng1: number, lat2: number, lng2: number): string {
    // Normalize to 6 decimal places
    const a = [lat1.toFixed(6), lng1.toFixed(6)].join(",");
    const b = [lat2.toFixed(6), lng2.toFixed(6)].join(",");
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  get(lat1: number, lng1: number, lat2: number, lng2: number): number | undefined {
    const k = this.key(lat1, lng1, lat2, lng2);
    const v = this.cache.get(k);
    // LRU: delete & re-set to move to end
    if (v !== undefined) {
      this.cache.delete(k);
      this.cache.set(k, v);
    }
    return v;
  }

  set(lat1: number, lng1: number, lat2: number, lng2: number, value: number): void {
    const k = this.key(lat1, lng1, lat2, lng2);
    this.cache.set(k, value);
    if (this.cache.size > this.max) {
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
  }

  get size(): number {
    return this.cache.size;
  }
}

// ─── OSRM Provider ───────────────────────────────────────────

const OSRM_BASE = "https://router.project-osrm.org";

/**
 * Fetch driving distance from OSRM's public demo server.
 * Rate-limited (~1 req/s) — suitable for small datasets.
 * Returns distance in km or null on failure.
 */
async function osrmRaw(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): Promise<number | null> {
  const url =
    `${OSRM_BASE}/route/v1/driving/${lng1},${lat1};${lng2},${lat2}` +
    `?overview=false&alternatives=false&steps=false`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "vrp-optimizer/1.0" },
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.length) return null;

    return data.routes[0].distance / 1000; // meters → km
  } catch {
    return null;
  }
}

// ─── OSRM with cache + concurrency control ───────────────────

const osrmCache = new LRUCache(5000);
let pendingRequests = 0;
const MAX_CONCURRENT = 3;
const requestQueue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (pendingRequests < MAX_CONCURRENT) {
    pendingRequests++;
    return;
  }
  return new Promise((resolve) => {
    requestQueue.push(() => {
      pendingRequests++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  pendingRequests--;
  const next = requestQueue.shift();
  if (next) next();
}

/**
 * OSRM-based routing with LRU cache and concurrency control.
 * Falls back to Haversine if OSRM fails.
 */
export async function osrmDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): Promise<number> {
  // Tiny distances → Haversine is fine (no road network)
  const H = haversineDistance(lat1, lng1, lat2, lng2);
  if (H < 0.05) return H; // < 50m → Haversine

  // Check cache
  const cached = osrmCache.get(lat1, lng1, lat2, lng2);
  if (cached !== undefined) return cached;

  // Fetch from OSRM
  await acquireSlot();
  try {
    const result = await osrmRaw(lat1, lng1, lat2, lng2);
    if (result !== null) {
      osrmCache.set(lat1, lng1, lat2, lng2, result);
      return result;
    }
  } finally {
    releaseSlot();
  }

  // Fallback to Haversine
  osrmCache.set(lat1, lng1, lat2, lng2, H);
  return H;
}

/**
 * Batch-compute a full distance matrix for N locations + home.
 * Returns a flat object of cached distances.
 * Home is assumed to be at index 0 in the coordinate list.
 */
export async function precomputeDistanceMatrix(
  coords: Array<{ lat: number; lng: number }>
): Promise<{ pairs: number; osrm: number; haversine: number }> {
  let osrmCount = 0;
  let haversineCount = 0;
  let pairs = 0;

  for (let i = 0; i < coords.length; i++) {
    for (let j = i + 1; j < coords.length; j++) {
      pairs++;
      const d = await osrmDistance(
        coords[i].lat,
        coords[i].lng,
        coords[j].lat,
        coords[j].lng
      );
      // Check if it's OSRM or Haversine by comparing
      const H = haversineDistance(
        coords[i].lat,
        coords[i].lng,
        coords[j].lat,
        coords[j].lng
      );
      if (Math.abs(d - H) > 0.1) osrmCount++;
      else haversineCount++;
    }
  }

  return { pairs, osrm: osrmCount, haversine: haversineCount };
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Get driving distance between two points, using OSRM when possible
 * and falling back to Haversine. Results are cached.
 */
export async function drivingDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): Promise<number> {
  return osrmDistance(lat1, lng1, lat2, lng2);
}

/** Clear the distance cache */
export function clearRoutingCache(): void {
  // Hack: recreate the cache
  Object.assign(osrmCache, {
    cache: new Map(),
  });
}

/** Check if a distance came from OSRM (real) or Haversine (estimated) */
export function isRealDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  distance: number
): boolean {
  const H = haversineDistance(lat1, lng1, lat2, lng2);
  return Math.abs(distance - H) > 0.1;
}

/**
 * PR 6 (real-roads-only): classify a single distance pair into one of
 * the `RoutingSource` tags used by the discriminated `MatrixEntry`
 * type. Replaces the boolean `isRealDistance` for callers that need
 * the type-level source rather than a yes/no answer.
 *
 *   - `"unreachable"` — distance is `Infinity` or otherwise missing
 *   - `"estimated"`   — sub-50m pair (Haversine is fine) OR the value
 *                       is within `REAL_VS_ESTIMATED_KM` of the
 *                       Haversine reference (provider returned null)
 *   - `"real"`        — distance differs from Haversine by more than
 *                       `REAL_VS_ESTIMATED_KM` (real road)
 *
 * `isRealDistance` is preserved for backward compatibility.
 */
export function classifyPair(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  distance: number
): RoutingSource {
  if (!Number.isFinite(distance)) return "unreachable";
  const H = haversineDistance(lat1, lng1, lat2, lng2);
  if (H < TINY_DISTANCE_KM) return "estimated";
  if (Math.abs(distance - H) < REAL_VS_ESTIMATED_KM) return "estimated";
  return "real";
}
