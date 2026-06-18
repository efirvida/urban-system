/**
 * Distance matrix builder — OSRM per pair with Haversine fallback.
 * 
 * Flow:
 * 1. For each pair, try OSRM Route service (3s timeout per call)
 * 2. If OSRM fails/times out, use Haversine
 * 3. Concurrency: 5 simultaneous requests
 */


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

/** Routing source for a day's geometry — drives dash styling on the map. */
export type RouteSource = "geoapify" | "osrm" | "haversine";

/** Fetch route geometry for map display */
export async function fetchRouteGeometry(stops: Array<{ lat: number; lng: number }>): Promise<[number, number][] | null> {
  if (stops.length < 2) return null;
  try {
    const res = await fetch("/api/routing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stops }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.coordinates || null;
  } catch { return null; }
}

// ─── Per-leg route cache (localStorage) ──────────────────────

const RC_PREFIX = "route_";

function routeLegKey(lat1: number, lng1: number, lat2: number, lng2: number): string {
  return RC_PREFIX + `${lat1.toFixed(5)},${lng1.toFixed(5)}|${lat2.toFixed(5)},${lng2.toFixed(5)}`;
}

function getCachedLeg(lat1: number, lng1: number, lat2: number, lng2: number): [number, number][] | null {
  try {
    const raw = localStorage.getItem(routeLegKey(lat1, lng1, lat2, lng2));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setCachedLeg(lat1: number, lng1: number, lat2: number, lng2: number, coords: [number, number][]): void {
  try { localStorage.setItem(routeLegKey(lat1, lng1, lat2, lng2), JSON.stringify(coords)); } catch {}
}

/** Extract unique consecutive pairs from a full coordinate array given waypoint indices */
function extractLeg(fullCoords: [number, number][], startIdx: number, endIdx: number): [number, number][] {
  // Find the indices in the full coords that correspond to the waypoints
  // For simplicity, return the sub-array from the full route
  // This is approximate — the API returns the full route, we just split it
  return fullCoords.slice(startIdx, endIdx + 1);
}

/** Find closest point index in coordinates to a given lng/lat */
function findClosestIdx(coords: [number, number][], lng: number, lat: number): number {
  let minD = Infinity, minI = 0;
  for (let i = 0; i < coords.length; i++) {
    const d = Math.abs(coords[i][0] - lng) + Math.abs(coords[i][1] - lat);
    if (d < minD) { minD = d; minI = i; }
  }
  return minI;
}

/** Fetch geometries for all days with per-leg caching.
 *  Returns the geometries map AND a parallel sources map so the map can
 *  render real-road routes as solid lines and estimated (Haversine) ones
 *  as dashed lines. When a day resolves from the per-leg cache (no fresh
 *  API call), its source is conservatively tagged as "haversine" — the
 *  cache does not store the original provider.
 */
export async function fetchAllRouteGeometries(
  days: Array<{ day: number; stops: Array<{ lat: number; lng: number; isHome?: boolean }> }>,
): Promise<{
  geometries: Map<number, [number, number][]>;
  sources: Map<number, RouteSource>;
}> {
  const geometries = new Map<number, [number, number][]>();
  const sources = new Map<number, RouteSource>();

  // Process each day
  for (const day of days) {
    // Build the full stop sequence: home → POIs → home
    const fullStops = [day.stops[0], ...day.stops.filter(s => !s.isHome), day.stops[0]];
    if (fullStops.length < 2) continue;

    // Check cache for each leg
    const dayCoords: [number, number][] = [];
    let allCached = true;
    const legCache: Array<[number, number][] | null> = [];

    for (let i = 0; i < fullStops.length - 1; i++) {
      const a = fullStops[i], b = fullStops[i + 1];
      const cached = getCachedLeg(a.lat, a.lng, b.lat, b.lng);
      legCache.push(cached);
      if (!cached) allCached = false;
    }

    if (allCached) {
      // All legs cached — stitch them together. CRITICAL: clone each leg
      // before shifting because getCachedLeg returns the SAME array ref;
      // mutating it with shift() corrupts the cache for subsequent calls.
      for (const leg of legCache) {
        if (leg && leg.length > 0) {
          const clone = [...leg];
          if (dayCoords.length > 0 && clone.length > 0) clone.shift(); // avoid duplicate junction
          dayCoords.push(...clone);
        }
      }
      // Source unknown for cached legs — conservative: mark as estimated
      // so the map dashes them. Per spec, this is acceptable.
      if (dayCoords.length > 0) {
        geometries.set(day.day, dayCoords);
        sources.set(day.day, "haversine");
      }
      continue;
    }

    // Fetch full route from API — capture the source the server reports
    let routeCoords: [number, number][] | null = null;
    let apiSource: RouteSource = "haversine";
    try {
      const res = await fetch("/api/routing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stops: fullStops }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        const data = await res.json();
        routeCoords = data.coordinates || null;
        // Validate the source field — fall back to "haversine" if absent or unexpected
        if (data.source === "geoapify" || data.source === "osrm" || data.source === "haversine") {
          apiSource = data.source;
        }
      }
    } catch {}

    if (!routeCoords) {
      // API failed — check if at least some legs are cached
      let hasAny = false;
      const fallback: [number, number][] = [];
      for (let i = 0; i < fullStops.length - 1; i++) {
        const a = fullStops[i], b = fullStops[i + 1];
        const cached = getCachedLeg(a.lat, a.lng, b.lat, b.lng);
        if (cached && cached.length > 0) {
          const clone = [...cached];
          if (fallback.length > 0 && clone.length > 0) clone.shift();
          fallback.push(...clone);
          hasAny = true;
        }
      }
      if (hasAny) {
        geometries.set(day.day, fallback);
        sources.set(day.day, "haversine");
      }
      continue;
    }

    // Split route into legs and cache each
    let coordIdx = 0;
    for (let i = 0; i < fullStops.length - 1; i++) {
      const a = fullStops[i], b = fullStops[i + 1];
      const cacheKey = routeLegKey(a.lat, a.lng, b.lat, b.lng);

      // If already cached, skip
      if (getCachedLeg(a.lat, a.lng, b.lat, b.lng)) continue;

      // Find where this leg starts/ends in the full route
      const startIdx = i === 0 ? 0 : findClosestIdx(routeCoords, a.lng, a.lat);
      const endIdx = i === fullStops.length - 2 ? routeCoords.length - 1 : findClosestIdx(routeCoords, b.lng, b.lat);
      const legCoords = routeCoords.slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1);
      if (legCoords.length > 0) setCachedLeg(a.lat, a.lng, b.lat, b.lng, legCoords);
    }

    // Reconstruct full day route from cache (clone each leg before shift!)
    for (let i = 0; i < fullStops.length - 1; i++) {
      const a = fullStops[i], b = fullStops[i + 1];
      const leg = getCachedLeg(a.lat, a.lng, b.lat, b.lng);
      if (leg && leg.length > 0) {
        const clone = [...leg];
        if (dayCoords.length > 0 && clone.length > 0) clone.shift();
        dayCoords.push(...clone);
      }
    }

    if (dayCoords.length > 0) {
      geometries.set(day.day, dayCoords);
      // Trust the source the server reported — could be "geoapify" / "osrm" / "haversine"
      sources.set(day.day, apiSource);
    }
  }

  return { geometries, sources };
}

// ─── Main ────────────────────────────────────────────────

export async function buildDistanceMatrices(
  homeLat: number, homeLng: number,
  locations: Array<{ lat: number; lng: number }>,
  onProgress: ProgressCallback
): Promise<{
  osrmMatrix: Map<string, number>;
  durationMatrix?: Map<string, number>;
}> {
  const all = [{ lat: homeLat, lng: homeLng }, ...locations];
  const n = all.length;
  const totalPairs = (n * (n - 1)) / 2;

  const osrmMatrix = new Map<string, number>();
  let realCount = 0, unreachableCount = 0, done = 0;
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
      realCount, haversineCount: unreachableCount,
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

      // Same point → 0
      if (p1.lat === p2.lat && p1.lng === p2.lng) {
        osrmMatrix.set(key, 0);
        realCount++;
        done++;
        if (done % 20 === 0) report();
        continue;
      }

      const ck = cacheKey(p1.lat, p1.lng, p2.lat, p2.lng);
      const cached = distCache.get(ck);
      if (cached !== undefined) {
        osrmMatrix.set(key, cached);
        if (Number.isFinite(cached)) realCount++;
        else unreachableCount++;
        done++;
        if (done % 20 === 0) report();
        continue;
      }

      try {
        const d = await osrmPair(p1.lat, p1.lng, p2.lat, p2.lng);
        if (d !== null) {
          osrmMatrix.set(key, d);
          distCache.set(ck, d);
          if (distCache.size > 10000) { const first = distCache.keys().next().value; if (first) distCache.delete(first); }
          realCount++;
        } else {
          osrmMatrix.set(key, Infinity);
          unreachableCount++;
        }
      } catch {
        osrmMatrix.set(key, Infinity);
        unreachableCount++;
      }
      done++;
      if (done % 10 === 0 || done === totalPairs) report();
    }
  }

  await Promise.all(Array.from({ length: MAX_WORKERS }, () => worker()));
  report();

  return { osrmMatrix, durationMatrix: undefined };
}
