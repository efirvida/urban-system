/**
 * OSRM Table Service — computes full distance/duration matrix in ONE request.
 *
 * Previously we made N² individual route requests (1128 for 47 locations).
 * Now we make 1 Table request that returns all pairs at once.
 *
 * Table service: GET /table/v1/driving/{lng,lat};{lng,lat};...
 * Returns durations[i][j] in seconds.
 *
 * We store both distance (km) derived from duration × avg speed,
 * and raw duration (seconds) for accurate constraint checking.
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

/**
 * Build distance + duration matrix using OSRM Table Service.
 * Sends ALL coordinates in one Table request for maximum efficiency.
 *
 * Returns:
 *   osrmMatrix: "i,j" → distance in km (derived from OSRM duration × speed)
 *   durationMatrix: "i,j" → duration in hours
 *   haversineMatrix: "i,j" → haversine distance in km (fallback)
 */
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

  // Build Haversine matrix (instant)
  const haversineMatrix = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      haversineMatrix.set(`${i},${j}`, haversineDistance(all[i].lat, all[i].lng, all[j].lat, all[j].lng));
    }
  }

  // Try OSRM Table service for DURATIONS only (distances stay Haversine)
  const osrmMatrix = new Map(haversineMatrix); // start with Haversine distances
  const durationMatrix = new Map<string, number>();
  let realCount = 0;

  const coords = all.map(p => `${p.lng},${p.lat}`).join(";");
  const url = `https://router.project-osrm.org/table/v1/driving/${coords}`;

  onProgress({
    phase: "matrix",
    stage: "Consultando OSRM Table Service...",
    current: 0, total: totalPairs,
    percent: 0, etaSeconds: 5,
    realCount: 0, haversineCount: 0,
  });

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (res.ok) {
      const data = await res.json();
      if (data.code === "Ok" && data.durations) {
        const dur = data.durations as number[][];
        for (let i = 0; i < n && i < dur.length; i++) {
          for (let j = i + 1; j < n && j < dur[i].length; j++) {
            if (dur[i][j] !== null && dur[i][j] > 0) {
              const hours = dur[i][j] / 3600;
              durationMatrix.set(`${i},${j}`, hours);
              realCount++;
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn("[OSRM Table] Failed:", err);
  }

  onProgress({
    phase: "matrix",
    stage: "Matriz completa",
    current: totalPairs, total: totalPairs,
    percent: 100, etaSeconds: 0,
    realCount: realCount,
    haversineCount: 0,
  });

  return {
    osrmMatrix, // Haversine distances (OSRM durations in durationMatrix)
    durationMatrix: realCount > 0 ? durationMatrix : undefined,
    haversineMatrix,
  };
}
