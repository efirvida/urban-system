/**
 * OSRM Table Service — full duration matrix in 1 request.
 * Distance = duration × userAvgSpeed (avgSpeed cancels out in constraint check).
 * Fast: 1 request vs N² individual route requests.
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

/** Get a single OSRM route distance (fallback for individual pairs) */
async function osrmRouteDistance(lat1: number, lng1: number, lat2: number, lng2: number): Promise<number | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`;
  for (let a = 0; a < 2; a++) {
    if (a > 0) await new Promise(r => setTimeout(r, 500));
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

/** Fetch route geometry for a full day (all stops as waypoints) */
export async function fetchRouteGeometry(
  stops: Array<{ lat: number; lng: number }>
): Promise<[number, number][] | null> {
  if (stops.length < 2) return null;
  const coords = stops.map(s => `${s.lng},${s.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=simplified&geometries=geojson&steps=false`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const d = await res.json();
    if (d.code === "Ok" && d.routes?.[0]?.geometry?.coordinates?.length) return d.routes[0].geometry.coordinates;
    return null;
  } catch { return null; }
}

/** Fetch geometries for all days (1 req per day) */
export async function fetchAllRouteGeometries(
  days: Array<{ day: number; stops: Array<{ lat: number; lng: number; isHome?: boolean }> }>,
): Promise<Map<number, [number, number][]>> {
  const result = new Map<number, [number, number][]>();
  for (const day of days) {
    const stops = day.stops.filter(s => !s.isHome);
    if (stops.length < 2) continue;
    const allStops = [day.stops[0], ...stops, day.stops[0]];
    const geo = await fetchRouteGeometry(allStops);
    if (geo) result.set(day.day, geo);
  }
  return result;
}

// ─── Main ────────────────────────────────────────────────────

/**
 * Build distance matrix using OSRM Table service (1 request).
 * Returns REAL driving durations converted to estimated km using avgSpeed.
 *
 * The constraint check is: hours = km/avgSpeed + stops*visitTime
 * With km = duration_hours × avgSpeed:
 *   hours = duration_hours × avgSpeed / avgSpeed + stops*visitTime
 *         = duration_hours + stops*visitTime  ← EXACTLY CORRECT
 */
export async function buildDistanceMatrices(
  homeLat: number,
  homeLng: number,
  locations: Array<{ lat: number; lng: number }>,
  onProgress: ProgressCallback,
  avgSpeed: number = 60
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

  const osrmMatrix = new Map<string, number>();
  const durationMatrix = new Map<string, number>();

  onProgress({ phase: "matrix", stage: "Consultando OSRM Table Service...", current: 0, total: totalPairs, percent: 0, etaSeconds: 5, realCount: 0, haversineCount: 0 });

  // Try Table service (1 request, all pairs)
  try {
    const coords = all.map(p => `${p.lng},${p.lat}`).join(";");
    const res = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}`, { signal: AbortSignal.timeout(30000) });
    if (res.ok) {
      const data = await res.json();
      if (data.code === "Ok" && data.durations) {
        const dur = data.durations as number[][];
        for (let i = 0; i < n && i < dur.length; i++) {
          for (let j = i + 1; j < n && j < dur[i].length; j++) {
            if (dur[i][j] !== null && dur[i][j] > 0) {
              const hours = dur[i][j] / 3600;
              durationMatrix.set(`${i},${j}`, hours);
              // Store as estimated km (will be divided by avgSpeed later, cancelling out)
              osrmMatrix.set(`${i},${j}`, hours * avgSpeed); // cancels out in constraint: hours = km/avgSpeed
            }
          }
        }
      }
    }
  } catch {}

  // Fill missing with Haversine
  let realCount = 0, haversineCount = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const key = `${i},${j}`;
      if (!osrmMatrix.has(key)) {
        osrmMatrix.set(key, haversineMatrix.get(key)!);
        haversineCount++;
      } else {
        realCount++;
      }
    }
  }

  onProgress({ phase: "matrix", stage: "Matriz completa", current: totalPairs, total: totalPairs, percent: 100, etaSeconds: 0, realCount, haversineCount });

  return { osrmMatrix, durationMatrix: durationMatrix.size > 0 ? durationMatrix : undefined, haversineMatrix };
}
