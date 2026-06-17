/**
 * Google Maps Distance Matrix provider.
 * Requires a Google Cloud API key with Distance Matrix API enabled.
 *
 * Pricing: $5/1000 requests, $200 monthly free credit.
 * For 47 locations → ~3 requests total → ~$0.015/optimization.
 */

import { haversineDistance } from "./haversine";

interface GoogleDistanceMatrixResponse {
  status: string;
  rows: Array<{
    elements: Array<{
      status: string;
      duration?: { value: number };
      distance?: { value: number };
    }>;
  }>;
}

/**
 * Build a distance matrix using Google Maps Distance Matrix API.
 * Uses efficient batching: up to 25 origins × 25 destinations per request.
 *
 * Falls back to Haversine for any pair that fails.
 */
export async function buildGoogleMatrix(
  apiKey: string,
  homeLat: number,
  homeLng: number,
  locations: Array<{ lat: number; lng: number }>,
  onProgress: (current: number, total: number) => void
): Promise<Map<string, number>> {
  const matrix = new Map<string, number>();
  const all = [{ lat: homeLat, lng: homeLng }, ...locations];
  const n = all.length;
  const totalPairs = (n * (n - 1)) / 2;
  let done = 0;

  const report = () => onProgress(done, totalPairs);

  // Helper to set a pair
  const setPair = (i: number, j: number, km: number) => {
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    matrix.set(key, km);
  };

  const getPair = (i: number, j: number): number | undefined => {
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    return matrix.get(key);
  };

  // Batch all origin rows into requests of up to 25 origins
  const BATCH_SIZE = 25;

  for (let originStart = 0; originStart < n; originStart += BATCH_SIZE) {
    const originEnd = Math.min(originStart + BATCH_SIZE, n);
    const origins: string[] = [];

    for (let i = originStart; i < originEnd; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (getPair(i, j) !== undefined) continue; // already have it
        origins.push(`${all[i].lat},${all[i].lng}`);
        break; // one destination per origin per request is fine
      }
    }

    if (origins.length === 0) continue;

    // For this batch of origins, collect all needed destinations
    const originIndices: number[] = [];
    const destIndices: number[][] = [];

    for (let i = originStart; i < originEnd; i++) {
      const dests: number[] = [];
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (getPair(Math.min(i, j), Math.max(i, j)) !== undefined) continue;
        dests.push(j);
      }
      if (dests.length > 0) {
        originIndices.push(i);
        destIndices.push(dests);
      }
    }

    if (originIndices.length === 0) continue;

    // Build a batch request: use the first origin's destinations
    // The Distance Matrix API can handle multiple origins × multiple destinations
    const allOrigins = originIndices.map(i => `${all[i].lat},${all[i].lng}`);
    const allDests = [...new Set(destIndices.flat())].map(j => `${all[j].lat},${all[j].lng}`);

    if (allOrigins.length === 0 || allDests.length === 0) continue;

    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json` +
      `?origins=${allOrigins.join("|")}` +
      `&destinations=${allDests.join("|")}` +
      `&key=${apiKey}` +
      `&units=metric` +
      `&avoid=indoor`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const data: GoogleDistanceMatrixResponse = await res.json();
        if (data.status === "OK" && data.rows) {
          for (let oi = 0; oi < data.rows.length; oi++) {
            const row = data.rows[oi];
            const realOriginIdx = originIndices[oi];
            for (let di = 0; di < row.elements.length; di++) {
              const el = row.elements[di];
              const realDestIdx = [...new Set(destIndices.flat())][di];
              if (el.status === "OK" && el.distance?.value !== undefined) {
                const km = el.distance.value / 1000;
                setPair(realOriginIdx, realDestIdx, km);
                done++;
              }
            }
          }
        }
      }
    } catch {}

    // Fill remaining pairs with Haversine
    for (let i = originStart; i < originEnd; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const key = i < j ? `${i},${j}` : `${j},${i}`;
        if (matrix.has(key)) continue;
        const km = haversineDistance(all[i].lat, all[i].lng, all[j].lat, all[j].lng);
        matrix.set(key, km);
        done++;
      }
    }

    report();
  }

  report();
  return matrix;
}
