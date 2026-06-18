import { RoutingSource } from "@/types";

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
    const a = [lat1.toFixed(6), lng1.toFixed(6)].join(",");
    const b = [lat2.toFixed(6), lng2.toFixed(6)].join(",");
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  get(lat1: number, lng1: number, lat2: number, lng2: number): number | undefined {
    const k = this.key(lat1, lng1, lat2, lng2);
    const v = this.cache.get(k);
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
 * Returns Infinity when no route is found (unreachable).
 */
export async function osrmDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): Promise<number> {
  // Same point → distance 0
  if (lat1 === lat2 && lng1 === lng2) return 0;

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

  // No route found — unreachable
  osrmCache.set(lat1, lng1, lat2, lng2, Infinity);
  return Infinity;
}

/**
 * Batch-compute a full distance matrix for N locations + home.
 * Returns counts of real (finite) vs unreachable (Infinity) pairs.
 */
export async function precomputeDistanceMatrix(
  coords: Array<{ lat: number; lng: number }>
): Promise<{ pairs: number; osrm: number; haversine: number }> {
  let osrmCount = 0;
  let unreachableCount = 0;
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
      if (Number.isFinite(d)) osrmCount++;
      else unreachableCount++;
    }
  }

  return { pairs, osrm: osrmCount, haversine: unreachableCount };
}

// ─── Public API ──────────────────────────────────────────────

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
  Object.assign(osrmCache, {
    cache: new Map(),
  });
}

/**
 * Check if a distance is real (finite) vs unreachable (Infinity).
 */
export function isRealDistance(
  _lat1: number,
  _lng1: number,
  _lat2: number,
  _lng2: number,
  distance: number
): boolean {
  return Number.isFinite(distance);
}

/**
 * Classify a distance pair into a RoutingSource tag.
 */
export function classifyPair(
  _lat1: number,
  _lng1: number,
  _lat2: number,
  _lng2: number,
  distance: number
): RoutingSource {
  if (!Number.isFinite(distance)) return "unreachable";
  return "real";
}
