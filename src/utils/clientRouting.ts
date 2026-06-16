import { haversineDistance } from "./haversine";

// ─── Types ───────────────────────────────────────────────────

export interface MatrixProgress {
  phase: "matrix";
  stage: string;
  current: number;
  total: number;
  percent: number;
  /** ETA in seconds (estimated) */
  etaSeconds: number;
  /** How many used real routing */
  realCount: number;
  /** How many fell back to Haversine */
  haversineCount: number;
}

export type ProgressCallback = (p: MatrixProgress) => void;

/** GeoJSON LineString coordinate pair */
type CoordPair = [number, number];

interface CacheEntry {
  distance: number;
  real: boolean;
  /** Route geometry (road-following polyline) for visualization */
  geometry?: CoordPair[];
}

// ─── LRU Cache (client-side) ─────────────────────────────────

class ClientCache {
  private max: number;
  private cache = new Map<string, CacheEntry>();

  constructor(max = 5000) {
    this.max = max;
  }

  private key(lat1: number, lng1: number, lat2: number, lng2: number): string {
    const a = [lat1.toFixed(6), lng1.toFixed(6)].join(",");
    const b = [lat2.toFixed(6), lng2.toFixed(6)].join(",");
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  get(lat1: number, lng1: number, lat2: number, lng2: number): CacheEntry | undefined {
    const k = this.key(lat1, lng1, lat2, lng2);
    const v = this.cache.get(k);
    if (v !== undefined) {
      this.cache.delete(k);
      this.cache.set(k, v);
    }
    return v;
  }

  set(lat1: number, lng1: number, lat2: number, lng2: number, entry: CacheEntry): void {
    const k = this.key(lat1, lng1, lat2, lng2);
    this.cache.set(k, entry);
    if (this.cache.size > this.max) {
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
  }
}

const cache = new ClientCache();

// ─── OSRM call from browser ──────────────────────────────────

/** Coordinate-based key for geometry lookup: lat1,lng1|lat2,lng2 (sorted) */
function coordKey(lat1: number, lng1: number, lat2: number, lng2: number): string {
  const a = `${lat1.toFixed(6)},${lng1.toFixed(6)}`;
  const b = `${lat2.toFixed(6)},${lng2.toFixed(6)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Fetch OSRM driving distance (no geometry — lighter/faster) */
async function osrmDistanceOnly(
  lat1: number, lng1: number, lat2: number, lng2: number, retries = 1
): Promise<number | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false&alternatives=false&steps=false`;
  for (let a = 0; a <= retries; a++) {
    if (a > 0) await new Promise((r) => setTimeout(r, a * 500));
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 8000);
      const res = await fetch(url, { signal: c.signal }); clearTimeout(t);
      if (!res.ok) continue;
      const d = await res.json();
      if (d.code === "Ok" && d.routes?.length) return d.routes[0].distance / 1000;
    } catch { continue; }
  }
  return null;
}

/** Fetch OSRM route geometry for visualization */
export async function fetchRouteGeometry(
  lat1: number, lng1: number, lat2: number, lng2: number
): Promise<CoordPair[] | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=simplified&geometries=geojson&alternatives=false&steps=false`;
  for (let a = 0; a <= 1; a++) {
    if (a > 0) await new Promise((r) => setTimeout(r, 600));
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 10000);
      const res = await fetch(url, { signal: c.signal }); clearTimeout(t);
      if (!res.ok) continue;
      const d = await res.json();
      if (d.code === "Ok" && d.routes?.length) {
        return d.routes[0].geometry?.coordinates ?? null;
      }
    } catch { continue; }
  }
  return null;
}

// ─── Build matrix with progress ──────────────────────────────

/**
 * Build TWO distance matrices for all points (home + locations):
 *  1. osrmMatrix — real road distances via OSRM (with Haversine fallback)
 *  2. haversineMatrix — pure straight-line distances
 *
 * Reports progress via callback during OSRM phase.
 * The Haversine matrix is computed instantly (no API calls).
 */
const CACHE_PREFIX = "vrp_matrix_";

/**
 * Build a cache key from coordinates hash.
 */
function cacheKey(homeLat: number, homeLng: number, locations: Array<{ lat: number; lng: number }>): string {
  let str = `${homeLat.toFixed(4)},${homeLng.toFixed(4)}`;
  for (const loc of locations) {
    str += `|${loc.lat.toFixed(4)},${loc.lng.toFixed(4)}`;
  }
  // Simple hash
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return CACHE_PREFIX + Math.abs(hash).toString(36);
}

/**
 * Fetch route geometry for consecutive stop pairs in optimized routes.
 * Only fetches ~N segments (one per consecutive stop pair), not N².
 * Reports progress via callback.
 */
export async function fetchRouteGeometries(
  routeStops: Array<{ lat: number; lng: number }[]>,
  onProgress: (current: number, total: number) => void
): Promise<Map<string, CoordPair[]>> {
  const geometry = new Map<string, CoordPair[]>();
  const segments: Array<{ a: { lat: number; lng: number }; b: { lat: number; lng: number } }> = [];

  // Collect all consecutive pairs from all routes
  for (const stops of routeStops) {
    for (let i = 0; i < stops.length - 1; i++) {
      segments.push({ a: stops[i], b: stops[i + 1] });
    }
  }

  // Check localStorage cache first
  const geoCacheKey = "vrp_geo_cache_v2";
  let cached: Record<string, CoordPair[]> = {};
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(geoCacheKey) : null;
    if (raw) cached = JSON.parse(raw);
  } catch {}

  let done = 0;
  let cachedHits = 0;

  const report = () => onProgress(done, segments.length);

  // Process with concurrency 2
  const MAX_CONCURRENT = 2;
  let idx = 0;

  async function worker() {
    while (idx < segments.length) {
      const segIdx = idx++;
      const { a, b } = segments[segIdx];
      const key = coordKey(a.lat, a.lng, b.lat, b.lng);

      // Check cache
      if (cached[key]) {
        geometry.set(key, cached[key]);
        cachedHits++;
      } else {
        // Fetch from OSRM
        try {
          const coords = await fetchRouteGeometry(a.lat, a.lng, b.lat, b.lng);
          if (coords && coords.length > 0) {
            geometry.set(key, coords);
            cached[key] = coords;
          }
        } catch {}
      }

      done++;
      if (done % 5 === 0 || done === segments.length) report();
    }
  }

  await Promise.all(Array.from({ length: MAX_CONCURRENT }, () => worker()));

  // Save to cache
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(geoCacheKey, JSON.stringify(cached));
    }
  } catch {}

  report();
  return geometry;
}

export async function buildDistanceMatrices(
  homeLat: number,
  homeLng: number,
  locations: Array<{ lat: number; lng: number }>,
  onProgress: ProgressCallback
): Promise<{
  osrmMatrix: Map<string, number>;
  haversineMatrix: Map<string, number>;
}> {
  const all = [{ lat: homeLat, lng: homeLng }, ...locations];
  const n = all.length;
  const totalPairs = (n * (n - 1)) / 2;

  // Haversine matrix — instant, no API calls
  const haversineMatrix = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const key = `${i},${j}`;
      haversineMatrix.set(key, haversineDistance(all[i].lat, all[i].lng, all[j].lat, all[j].lng));
    }
  }

  // ── Check localStorage cache ──
  const ck = cacheKey(homeLat, homeLng, locations);
  let cached: Record<string, number> | null = null;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(ck) : null;
    if (raw) {
      cached = JSON.parse(raw);
    }
  } catch {}

  if (cached) {
    const osrmMatrix = new Map(Object.entries(cached));
    onProgress({
      phase: "matrix",
      stage: "Matriz de distancias cargada de caché",
      current: totalPairs,
      total: totalPairs,
      percent: 100,
      etaSeconds: 0,
      realCount: Object.keys(cached).length,
      haversineCount: 0,
    });
    return { osrmMatrix, haversineMatrix };
  }

  // OSRM matrix — needs API calls
  const osrmMatrix = new Map<string, number>();

  let done = 0;
  let realCount = 0;
  let haversineCount = 0;
  const startTime = Date.now();

  const report = () => {
    const elapsed = (Date.now() - startTime) / 1000;
    const speed = done / Math.max(elapsed, 0.1);
    const remaining = totalPairs - done;
    const eta = speed > 0 ? remaining / speed : 999;

    onProgress({
      phase: "matrix",
      stage: done < totalPairs / 2 ? "Consultando rutas reales (OSRM)..." : "Finalizando cómputo de distancias...",
      current: done,
      total: totalPairs,
      percent: Math.round((done / totalPairs) * 100),
      etaSeconds: Math.round(eta),
      realCount,
      haversineCount,
    });
  };

  // Rate limiting: max 2 concurrent requests to avoid OSRM rate limits
  const MAX_CONCURRENT = 2;

  const pairs: Array<{ i: number; j: number }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      pairs.push({ i, j });
    }
  }

  // Process in batches with concurrency control
  let idx = 0;

  async function processPair(): Promise<void> {
    while (idx < pairs.length) {
      const pair = pairs[idx++];
      const { i, j } = pair;
      const key = `${i},${j}`;

      const p1 = all[i];
      const p2 = all[j];

      const H = haversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);

      // Tiny distance → Haversine
      if (H < 0.05) {
        osrmMatrix.set(key, H);
        haversineCount++;
        done++;
        if (done % 10 === 0 || done === totalPairs) report();
        continue;
      }

      // Check cache
      const cached = cache.get(p1.lat, p1.lng, p2.lat, p2.lng);
      if (cached) {
        osrmMatrix.set(key, cached.distance);
        if (cached.real) realCount++;
        else haversineCount++;
        done++;
        if (done % 10 === 0 || done === totalPairs) report();
        continue;
      }

      // Fetch distance from OSRM (no geometry — fetched later for route segments only)
      let d = await osrmDistanceOnly(p1.lat, p1.lng, p2.lat, p2.lng);
      if (d === null) d = H; // fallback to Haversine

      const isReal = Math.abs(d - H) > 0.1;
      osrmMatrix.set(key, d);
      cache.set(p1.lat, p1.lng, p2.lat, p2.lng, { distance: d, real: isReal });
      if (isReal) realCount++;
      else haversineCount++;

      done++;
      if (done % 5 === 0 || done === totalPairs) report();
    }
  }

  // Run concurrent workers
  const workers = Array.from({ length: MAX_CONCURRENT }, () => processPair());
  await Promise.all(workers);

  report();

  // ── Save to localStorage cache ──
  try {
    const obj: Record<string, number> = {};
    osrmMatrix.forEach((v, k) => { obj[k] = v; });
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ck, JSON.stringify(obj));
    }
  } catch {}

  return { osrmMatrix, haversineMatrix };
}

/** Get distance from matrix */
export function getMatrixDistance(
  matrix: Map<string, number>,
  i: number,
  j: number
): number {
  const key = i < j ? `${i},${j}` : `${j},${i}`;
  return matrix.get(key) ?? 0;
}
