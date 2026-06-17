/**
 * Distance matrix builder — OSRM per pair with Haversine fallback.
 * 
 * Flow:
 * 1. For each pair, try OSRM Route service (3s timeout per call)
 * 2. If OSRM fails/times out, use Haversine
 * 3. Concurrency: 5 simultaneous requests
 */

import { haversineDistance } from "./haversine";

export interface MatrixProgress {
  phase: "matrix";
  stage: string;
  current: number;
  total: number;
  percent: number;
  etaSeconds: number;
  realCount: number;
  haversineCount: number;
}

export type ProgressCallback = (p: MatrixProgress) => void;

// ─── Cache ───────────────────────────────────────────────

const distCache = new Map<string, number>();
function cacheKey(lat1: number, lng1: number, lat2: number, lng2: number): string {
  const a = `${lat1.toFixed(6)},${lng1.toFixed(6)}`;
  const b = `${lat2.toFixed(6)},${lng2.toFixed(6)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ─── OSRM single pair ────────────────────────────────────

async function osrmPair(lat1: number, lng1: number, lat2: number, lng2: number): Promise<number | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`;
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 3000);
    const res = await fetch(url, { signal: c.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.code === "Ok" && d.routes?.length) return d.routes[0].distance / 1000;
    return null;
  } catch { return null; }
}

/** Fetch route geometry for map display */
export async function fetchRouteGeometry(stops: Array<{ lat: number; lng: number }>): Promise<[number, number][] | null> {
  if (stops.length < 2) return null;
  const coords = stops.map(s => `${s.lng},${s.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=simplified&geometries=geojson&steps=false`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const d = await res.json();
    if (d.code === "Ok" && d.routes?.[0]?.geometry?.coordinates?.length) return d.routes[0].geometry.coordinates;
    return null;
  } catch { return null; }
}

/** Fetch geometries for all days */
export async function fetchAllRouteGeometries(
  days: Array<{ day: number; stops: Array<{ lat: number; lng: number; isHome?: boolean }> }>,
): Promise<Map<number, [number, number][]>> {
  const result = new Map<number, [number, number][]>();
  for (const day of days) {
    const stops = day.stops.filter(s => !s.isHome);
    if (stops.length < 2) continue;
    const geo = await fetchRouteGeometry([day.stops[0], ...stops, day.stops[0]]);
    if (geo) result.set(day.day, geo);
  }
  return result;
}

// ─── Main ────────────────────────────────────────────────

export async function buildDistanceMatrices(
  homeLat: number, homeLng: number,
  locations: Array<{ lat: number; lng: number }>,
  onProgress: ProgressCallback
): Promise<{
  osrmMatrix: Map<string, number>;
  durationMatrix?: Map<string, number>;
  haversineMatrix: Map<string, number>;
}> {
  const all = [{ lat: homeLat, lng: homeLng }, ...locations];
  const n = all.length;
  const totalPairs = (n * (n - 1)) / 2;

  // Haversine fallback matrix
  const haversineMatrix = new Map<string, number>();
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      haversineMatrix.set(`${i},${j}`, haversineDistance(all[i].lat, all[i].lng, all[j].lat, all[j].lng));

  const osrmMatrix = new Map<string, number>();
  let realCount = 0, haversineCount = 0, done = 0;
  const startTime = Date.now();

  const report = () => {
    const elapsed = (Date.now() - startTime) / 1000;
    const speed = done / Math.max(elapsed, 0.1);
    onProgress({
      phase: "matrix",
      stage: realCount > 0 ? `OSRM: ${realCount} pares reales` : "Calculando distancias...",
      current: done, total: totalPairs,
      percent: Math.round((done / totalPairs) * 100),
      etaSeconds: speed > 0 ? Math.round((totalPairs - done) / speed) : 999,
      realCount, haversineCount,
    });
  };

  // Collect all pairs
  const pairs: Array<{ i: number; j: number }> = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      pairs.push({ i, j });

  // Process with concurrency
  const MAX_WORKERS = 5;
  let idx = 0;

  async function worker() {
    while (idx < pairs.length) {
      const pair = pairs[idx++];
      const { i, j } = pair;
      const key = `${i},${j}`;
      const p1 = all[i], p2 = all[j];
      const H = haversineMatrix.get(key)!;

      if (H < 0.05) { osrmMatrix.set(key, H); haversineCount++; done++; if (done % 20 === 0) report(); continue; }

      const ck = cacheKey(p1.lat, p1.lng, p2.lat, p2.lng);
      const cached = distCache.get(ck);
      if (cached !== undefined) { osrmMatrix.set(key, cached); if (Math.abs(cached - H) > 0.1) realCount++; else haversineCount++; done++; if (done % 20 === 0) report(); continue; }

      try {
        const d = await osrmPair(p1.lat, p1.lng, p2.lat, p2.lng);
        if (d !== null) {
          osrmMatrix.set(key, d);
          distCache.set(ck, d);
          if (distCache.size > 10000) { const first = distCache.keys().next().value; if (first) distCache.delete(first); }
          if (Math.abs(d - H) > 0.1) realCount++; else haversineCount++;
        } else {
          osrmMatrix.set(key, H); haversineCount++;
        }
      } catch { osrmMatrix.set(key, H); haversineCount++; }
      done++;
      if (done % 10 === 0 || done === totalPairs) report();
    }
  }

  await Promise.all(Array.from({ length: MAX_WORKERS }, () => worker()));
  report();

  return { osrmMatrix, durationMatrix: undefined, haversineMatrix };
}
