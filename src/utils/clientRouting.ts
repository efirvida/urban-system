/**
 * Distance matrix builder — pure Haversine (instant, no API calls).
 * No OSRM, no Google Maps — just geometry.
 * The algorithm produces the same routes regardless of distance accuracy.
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

/** Fetch route geometry for a full day via OSRM */
export async function fetchRouteGeometry(
  stops: Array<{ lat: number; lng: number }>
): Promise<[number, number][] | null> {
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

/** Fetch geometries for all days (1 req per day, fires and forgets) */
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

/** Build pure Haversine distance matrix — instant, no API calls */
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

  const matrix = new Map<string, number>();
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      matrix.set(`${i},${j}`, haversineDistance(all[i].lat, all[i].lng, all[j].lat, all[j].lng));

  onProgress({ phase: "matrix", stage: "Matriz de distancias lista", current: totalPairs, total: totalPairs, percent: 100, etaSeconds: 0, realCount: 0, haversineCount: totalPairs });

  return { osrmMatrix: matrix, durationMatrix: undefined, haversineMatrix: matrix };
}
