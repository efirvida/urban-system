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

interface CacheEntry {
  distance: number;
  real: boolean;
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

async function osrmFetch(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  retries = 2
): Promise<number | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false&alternatives=false&steps=false`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // Wait before retry (500ms, 1s)
      await new Promise((r) => setTimeout(r, attempt * 500));
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json();
      if (data.code !== "Ok" || !data.routes?.length) continue;
      return data.routes[0].distance / 1000;
    } catch {
      continue;
    }
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

      // Fetch from OSRM
      try {
        const result = await osrmFetch(p1.lat, p1.lng, p2.lat, p2.lng);
        if (result !== null) {
          const isReal = Math.abs(result - H) > 0.1;
          osrmMatrix.set(key, result);
          cache.set(p1.lat, p1.lng, p2.lat, p2.lng, { distance: result, real: isReal });
          if (isReal) realCount++;
          else haversineCount++;
        } else {
          osrmMatrix.set(key, H);
          cache.set(p1.lat, p1.lng, p2.lat, p2.lng, { distance: H, real: false });
          haversineCount++;
        }
      } catch {
        osrmMatrix.set(key, H);
        haversineCount++;
      }

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
