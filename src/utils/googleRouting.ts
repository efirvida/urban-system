/**
 * Google Maps Routes API — ComputeRouteMatrix provider.
 *
 * Modern replacement for Distance Matrix API.
 * Supports up to 100 origins × 100 destinations per request.
 *
 * Requires: billing enabled, Routes API + Distance Matrix API activated.
 * Free tier: $200/month credit → ~20,000 optimizations for 47 locations.
 *
 * PR 6 (real-roads-only): this file is dead code at the moment
 * (googleRouting.ts is not wired into the API route). The legacy
 * `Record<string, number>` return type is preserved so the type
 * migration in PR 6 does not break the compile. When this file is
 * eventually activated, the builder should be updated to also return
 * a `DistanceMatrix` (per-pair `MatrixEntry`) so the API can use the
 * strict path; the underlying realCount/fallbackCount counters
 * already align with the `real`/`estimated` source tags.
 */

const ROUTES_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

interface RouteMatrixElement {
  originIndex: number;
  destinationIndex: number;
  distanceMeters?: number;
  duration?: string;
}

/**
 * Build distance matrix using Google Routes API (ComputeRouteMatrix).
 * Batches origins in groups of up to 25 to stay within limits.
 * Falls back to Haversine for any pair that fails.
 */
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

  const has = (i: number, j: number): boolean => {
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    return key in matrix;
  };

  const BATCH = 25;

  for (let oStart = 0; oStart < n; oStart += BATCH) {
    const oEnd = Math.min(oStart + BATCH, n);

    // Collect origins that still need destinations
    const needOrigins: number[] = [];
    const needDests = new Set<number>();

    for (let i = oStart; i < oEnd; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j && !has(i, j)) {
          needOrigins.push(i);
          for (let k = 0; k < n; k++) {
            if (i !== k && !has(i, k)) needDests.add(k);
          }
          break;
        }
      }
    }

    if (needOrigins.length === 0) continue;

    const origins = needOrigins.map(i => ({
      waypoint: { location: { latLng: { latitude: locations[i].lat, longitude: locations[i].lng } } },
    }));
    const destArray = [...needDests];
    const destinations = destArray.map(j => ({
      waypoint: { location: { latLng: { latitude: locations[j].lat, longitude: locations[j].lng } } },
    }));

    try {
      const res = await fetch(ROUTES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "originIndex,destinationIndex,distanceMeters",
        },
        body: JSON.stringify({
          origins,
          destinations,
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const data: RouteMatrixElement[] = await res.json();
        if (Array.isArray(data)) {
          for (const el of data) {
            const oi = needOrigins[el.originIndex];
            const dj = destArray[el.destinationIndex];
            if (el.distanceMeters !== undefined && oi !== undefined && dj !== undefined) {
              set(oi, dj, el.distanceMeters / 1000);
              realCount++;
            }
          }
        }
      } else {
        const errText = await res.text().catch(() => "");
        if (errText.includes("billing")) {
          console.warn("[GoogleMatrix] Billing not enabled. Falling back to Haversine.");
        } else if (errText.includes("not enabled")) {
          console.warn("[GoogleMatrix] Routes API not enabled for this key.");
        }
      }
    } catch (err) {
      console.warn("[GoogleMatrix] Request failed:", err);
    }

    // Fill remaining with Haversine
    for (let i = oStart; i < oEnd; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j || has(i, j)) continue;
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
