/**
 * OSRM distance matrix builder.
 * Uses individual Route requests per pair (returns real road distances).
 * Falls back to Haversine when OSRM is unavailable.
 * Also fetches Table service for duration data (1 request, all pairs).
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

// ─── LRU Cache ───────────────────────────────────────────────

const distCache = new Map<string, number>();

function cacheKey(lat1: number, lng1: number, lat2: number, lng2: number): string {
  const a = `${lat1.toFixed(6)},${lng1.toFixed(6)}`;
  const b = `${lat2.toFixed(6)},${lng2.toFixed(6)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function cacheGet(lat1: number, lng1: number, lat2: number, lng2: number): number | undefined {
  const k = cacheKey(lat1, lng1, lat2, lng2);
  const v = distCache.get(k);
  if (v !== undefined) { distCache.delete(k); distCache.set(k, v); }
  return v;
}

function cacheSet(lat1: number, lng1: number, lat2: number, lng2: number, km: number): void {
  const k = cacheKey(lat1, lng1, lat2, lng2);
  distCache.set(k, km);
  if (distCache.size > 5000) { const first = distCache.keys().next().value; if (first) distCache.delete(first); }
}

// ─── OSRM Route Service (returns real road distance in km) ──

async function osrmRouteDistance(lat1: number, lng1: number, lat2: number, lng2: number): Promise<number | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 500));
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

// ─── OSRM Table Service (durations only, 1 request) ─────────

async function fetchDurations(all: Array<{ lat: number; lng: number }>): Promise<Map<string, number> | null> {
  const coords = all.map(p => `${p.lng},${p.lat}`).join(";");
  try {
    const res = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}`, { signal: AbortSignal.timeout(30000) });
    if (res.ok) {
      const data = await res.json();
      if (data.code === "Ok" && data.durations) {
        const dur = data.durations as number[][];
        const map = new Map<string, number>();
        for (let i = 0; i < all.length && i < dur.length; i++)
          for (let j = i + 1; j < all.length && j < dur[i].length; j++)
            if (dur[i][j] !== null && dur[i][j] > 0) map.set(`${i},${j}`, dur[i][j] / 3600);
        return map;
      }
    }
  } catch {}
  return null;
}

// ─── Main ────────────────────────────────────────────────────

export async function buildDistanceMatrices(
  homeLat: number,
  homeLng: number,
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

  // Haversine matrix (instant, fallback)
  const haversineMatrix = new Map<string, number>();
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      haversineMatrix.set(`${i},${j}`, haversineDistance(all[i].lat, all[i].lng, all[j].lat, all[j].lng));

  // Start OSRM Table request in background (durations only)
  const tablePromise = fetchDurations(all);

  // Build distance matrix with individual OSRM Route requests
  const osrmMatrix = new Map<string, number>();
  let realCount = 0;
  let haversineCount = 0;
  let done = 0;
  const startTime = Date.now();

  const report = () => {
    const elapsed = (Date.now() - startTime) / 1000;
    const speed = done / Math.max(elapsed, 0.1);
    const remaining = totalPairs - done;
    const eta = speed > 0 ? remaining / speed : 999;
    onProgress({
      phase: "matrix",
      stage: done < totalPairs / 2 ? "Consultando rutas reales (OSRM)..." : "Finalizando...",
      current: done, total: totalPairs,
      percent: Math.round((done / totalPairs) * 100),
      etaSeconds: Math.round(eta), realCount, haversineCount,
    });
  };

  // Collect all pairs
  const pairs: Array<{ i: number; j: number }> = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      pairs.push({ i, j });

  // Process with concurrency control
  const MAX_CONCURRENT = 3;
  let idx = 0;

  async function worker() {
    while (idx < pairs.length) {
      const pair = pairs[idx++];
      const { i, j } = pair;
      const key = `${i},${j}`;
      const p1 = all[i], p2 = all[j];
      const H = haversineMatrix.get(key)!;

      // Tiny distance → Haversine is fine
      if (H < 0.05) { osrmMatrix.set(key, H); haversineCount++; done++; if (done % 10 === 0) report(); continue; }

      // Check cache
      const cached = cacheGet(p1.lat, p1.lng, p2.lat, p2.lng);
      if (cached !== undefined) {
        osrmMatrix.set(key, cached);
        if (Math.abs(cached - H) > 0.1) realCount++; else haversineCount++;
        done++; if (done % 10 === 0) report(); continue;
      }

      // Fetch from OSRM
      try {
        const dist = await osrmRouteDistance(p1.lat, p1.lng, p2.lat, p2.lng);
        if (dist !== null) {
          osrmMatrix.set(key, dist);
          cacheSet(p1.lat, p1.lng, p2.lat, p2.lng, dist);
          if (Math.abs(dist - H) > 0.1) realCount++; else haversineCount++;
        } else {
          osrmMatrix.set(key, H);
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

  await Promise.all(Array.from({ length: MAX_CONCURRENT }, () => worker()));

  // Get durations from Table (background, may be null)
  const durationMatrix = await tablePromise;

  report();
  return { osrmMatrix, durationMatrix: durationMatrix ?? undefined, haversineMatrix };
}
