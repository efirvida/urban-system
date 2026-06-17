/**
 * Server-side Google Maps Distance Matrix provider.
 * Reads GOOGLE_MAPS_API_KEY from environment.
 * Builds a distance matrix with just 3-4 API calls (batched 25×25).
 */

import { haversineDistance } from "./haversine";

const GOOGLE_API = "https://maps.googleapis.com/maps/api/distancematrix/json";

interface Element {
  status: string;
  distance?: { value: number }; // meters
}

/** Build distance matrix using Google Maps API (server-side). */
export async function buildGoogleMatrix(
  locations: Array<{ lat: number; lng: number }>,
  apiKey: string
): Promise<{ matrix: Record<string, number>; realCount: number; fallbackCount: number }> {
  const n = locations.length;
  const matrix: Record<string, number> = {};
  let realCount = 0;
  let fallbackCount = 0;

  const set = (i: number, j: number, km: number) => {
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    if (!(key in matrix)) matrix[key] = km;
  };

  const get = (i: number, j: number): number | undefined => {
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    return matrix[key];
  };

  // Batch origins in groups of up to 25
  const BATCH = 25;
  for (let oStart = 0; oStart < n; oStart += BATCH) {
    const oEnd = Math.min(oStart + BATCH, n);
    const originIndices: number[] = [];
    const allDestIndices = new Set<number>();

    for (let i = oStart; i < oEnd; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (get(i, j) !== undefined) continue;
        originIndices.push(i);
        for (let j2 = 0; j2 < n; j2++) {
          if (i !== j2 && get(i, j2) === undefined) allDestIndices.add(j2);
        }
        break;
      }
    }

    if (originIndices.length === 0) continue;

    const origins = originIndices.map(i => `${locations[i].lat},${locations[i].lng}`);
    const dests = [...allDestIndices].map(j => `${locations[j].lat},${locations[j].lng}`);

    try {
      const url = `${GOOGLE_API}?origins=${encodeURIComponent(origins.join("|"))}&destinations=${encodeURIComponent(dests.join("|"))}&key=${apiKey}&units=metric`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "OK" && data.rows) {
          for (let oi = 0; oi < data.rows.length && oi < originIndices.length; oi++) {
            const oiActual = originIndices[oi];
            const elements: Element[] = data.rows[oi].elements || [];
            const destArray = [...allDestIndices];
            for (let di = 0; di < elements.length && di < destArray.length; di++) {
              const el = elements[di];
              const djActual = destArray[di];
              if (el.status === "OK" && el.distance?.value !== undefined) {
                set(oiActual, djActual, el.distance.value / 1000);
                realCount++;
              }
            }
          }
        }
      }
    } catch {}

    // Fill any missing pairs in this batch with Haversine
    for (let i = oStart; i < oEnd && i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (get(i, j) !== undefined) continue;
        const km = haversineDistance(
          locations[i].lat, locations[i].lng,
          locations[j].lat, locations[j].lng
        );
        set(i, j, km);
        fallbackCount++;
      }
    }
  }

  return { matrix, realCount, fallbackCount };
}
