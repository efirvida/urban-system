import { Location, Config, DayRoute, Stop, DistanceMatrix } from "@/types";
import { improveWithGA } from "./geneticOptimizer";
import { haversineDistance } from "./haversine";

/**
 * Look up distance from the precomputed matrix.
 * a, b: location indices (-1 = home, 0..n-1 = locations)
 * matrix: optional flat `Record<"i,j", km>` view (1.x legacy). Used
 *         as a fallback by the edit-mode `reoptimizeDay` helper
 *         when a pair isn't in the strict matrix.
 * strictMatrix: PR 6 `DistanceMatrix` (per-pair `MatrixEntry`).
 *               Always provided in the optimize pipeline; the legacy
 *               strict-vs-flat branch is gone.
 *
 * Exported for tests — see `routerOptimizer.test.ts`.
 */
export function matGet(
  a: number,
  b: number,
  matrix: Record<string, number> | undefined,
  strictMatrix: DistanceMatrix
): number {
  const ka = a === -1 ? 0 : a + 1;
  const kb = b === -1 ? 0 : b + 1;
  const key = ka < kb ? `${ka},${kb}` : `${kb},${ka}`;

  const entry = strictMatrix[key];
  if (entry === undefined) {
    // Fall back to the flat view if it has the pair. This matches
    // the edit-mode behaviour where the strict matrix only covers
    // reachable pairs and Haversine is used otherwise.
    const flat = matrix?.[key];
    if (flat !== undefined && Number.isFinite(flat)) return flat;
    console.warn(`[matGet] Missing strict key "${key}" (a=${a}, b=${b}), returning Infinity`);
    return Infinity;
  }
  return entry.distance;
}

// ─── Main entry point ────────────────────────────────────────

export async function optimizeRoutes(
  locations: Location[],
  config: Config,
  precomputedMatrix: Record<string, number> | undefined,
  strictMatrix: DistanceMatrix
): Promise<{
  days: DayRoute[];
  totalDistance: number;
  osrmPairs: number;
  totalPairs: number;
}> {
  if (locations.length === 0) {
    return { days: [], totalDistance: 0, osrmPairs: 0, totalPairs: 0 };
  }

  const FLOW = "[FLOW]";
  const tStart = Date.now();

  const home: Location = {
    name: "Casa",
    lat: config.homeLat,
    lng: config.homeLng,
  };

  console.log(`${FLOW}   routerOptimizer: ${locations.length} locations${strictMatrix ? " (strict matrix)" : ""}`);
  // ── Step 1: Build a giant TSP tour ──
  // Nearest Neighbor + 2-opt improvement
  const tour = await buildGiantTour(locations, home, config, strictMatrix, precomputedMatrix);

  // ── Step 2: Slice the tour into daily segments ──
  let solution = sliceTourToSolution(tour, locations, home, config, strictMatrix, precomputedMatrix);

  // ── Step 3: Local Search improvement (OR-Tools style) ──
  solution = localSearch(solution, locations, home, config, strictMatrix, precomputedMatrix);

  // ── Convert deterministic result ──
  const detDays = solutionToDays(solution, locations, home, config, strictMatrix, precomputedMatrix);
  const detDistance = detDays.reduce((sum, d) => sum + d.totalDistance, 0);
  console.log(`${FLOW}   deterministic: ${detDays.length} days, ${detDistance.toFixed(1)}km`);

  // ── Step 4: GA post-optimization ──
  let bestDays = detDays;
  let bestDistance = detDistance;

  if (locations.length >= 3) {
    const t4 = Date.now();
    try {
      const gaResult = await improveWithGA(tour, locations, home, config, precomputedMatrix, strictMatrix);
      const gaMs = Date.now() - t4;
      const impr = gaResult.totalDistance < bestDistance ? (bestDistance - gaResult.totalDistance).toFixed(2) : "0";
      console.log(`${FLOW}   improveWithGA: ${gaResult.totalDays}d, ${gaResult.totalDistance}km, improvement: ${impr}km in ${gaMs}ms`);
      if (gaResult.totalDistance < bestDistance) {
        bestDays = gaResult.days;
        bestDistance = gaResult.totalDistance;
        console.log(`${FLOW}   → GA improved solution by ${impr}km`);
      } else {
        console.log(`${FLOW}   → Deterministic solution was better, keeping it`);
      }
    } catch (err) {
      console.warn("[GA] Post-optimization failed, using deterministic result:", err);
    }
  } else {
    console.log(`${FLOW}   improveWithGA: skipped (< 3 locations)`);
  }

  console.log(`${FLOW}   routerOptimizer total: ${Date.now() - tStart}ms, det=${detDistance.toFixed(1)}km, best=${bestDistance.toFixed(1)}km, ${bestDays.length} days`);

  return {
    days: bestDays,
    totalDistance: Math.round(bestDistance * 100) / 100,
    osrmPairs: precomputedMatrix ? Object.keys(precomputedMatrix).length : 0,
    totalPairs: (locations.length * (locations.length + 1)) / 2,
  };
}

// ─── Step 1: Giant TSP Tour ──────────────────────────────────

async function buildGiantTour(
  locations: Location[],
  home: Location,
  config: Config,
  strictMatrix: DistanceMatrix,
  precomputed?: Record<string, number>,

): Promise<number[]> {
  // Nearest Neighbor
  const n = locations.length;
  const visited = new Set<number>();
  const tour: number[] = [];

  let currentLat = home.lat;
  let currentLng = home.lng;

  let prevLocIdx = -1; // home
  let stuckCount = 0;
  while (visited.size < n) {
    let nearest = -1;
    let nearestDist = Infinity;

    for (let i = 0; i < n; i++) {
      if (visited.has(i)) continue;
      const d = matGet(prevLocIdx, i, precomputed, strictMatrix);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    }

    if (nearest === -1) {
      stuckCount++;
      if (stuckCount > n) {
        // Safety: if stuck in a loop (all remaining POIs unreachable
        // even from home), force-include the first unvisited POI so
        // the tour doesn't abort prematurely.
        const firstUnvisited = Array.from({ length: n }, (_, i) => i).find(i => !visited.has(i));
        if (firstUnvisited === undefined) break;
        console.warn(`[Tour] Forcing POI ${firstUnvisited} into tour (stuck after ${stuckCount} attempts)`);
        tour.push(firstUnvisited);
        visited.add(firstUnvisited);
        prevLocIdx = firstUnvisited;
        stuckCount = 0;
        continue;
      }
      // No reachable neighbor from current POI — restart from home.
      prevLocIdx = -1;
      continue;
    }

    stuckCount = 0;
    tour.push(nearest);
    visited.add(nearest);
    prevLocIdx = nearest;
  }

  // 2-opt improvement
  improveTour2Opt(tour, locations, strictMatrix, precomputed);

  return tour;
}

// ─── 2-opt improvement ───────────────────────────────────────

function tourDist(
  tour: number[],
  locations: Location[],
  strictMatrix: DistanceMatrix,
  precomputed?: Record<string, number>,
): number {
  if (tour.length <= 1) return 0;
  let total = 0;
  for (let i = 0; i < tour.length - 1; i++) {
    total += pd(tour[i], tour[i + 1], precomputed, strictMatrix);
  }
  return total;
}

function pd(
  a: number,
  b: number,
  matrix: Record<string, number> | undefined,
  strictMatrix: DistanceMatrix
): number {
  return matGet(a, b, matrix, strictMatrix);
}

function improveTour2Opt(
  tour: number[],
  locations: Location[],
  strictMatrix: DistanceMatrix,
  precomputed?: Record<string, number>,
): void {
  if (tour.length < 3) return;

  let improved = true;
  let iterations = 0;
  const MAX_ITER = 100;

  while (improved && iterations < MAX_ITER) {
    improved = false;
    iterations++;

    for (let i = 0; i < tour.length - 2; i++) {
      for (let j = i + 2; j < tour.length - 1; j++) {
        // Current edges: (i, i+1) and (j, j+1)
        const d1 = pd(tour[i], tour[i + 1], precomputed, strictMatrix);
        const d2 = pd(tour[j], tour[j + 1], precomputed, strictMatrix);
        // Proposed edges: (i, j) and (i+1, j+1)
        const d3 = pd(tour[i], tour[j], precomputed, strictMatrix);
        const d4 = pd(tour[i + 1], tour[j + 1], precomputed, strictMatrix);

        if (d1 + d2 > d3 + d4) {
          // Swap: reverse segment [i+1, j]
          let left = i + 1;
          let right = j;
          while (left < right) {
            const tmp = tour[left];
            tour[left] = tour[right];
            tour[right] = tmp;
            left++;
            right--;
          }
          improved = true;
        }
      }
    }
  }
}

// ─── Step 2: Slice Tour into Solution ────────────────────────

/** Solution = array of days, each day = array of location indices */
type Solution = number[][];

function sliceTourToSolution(
  tour: number[],
  locations: Location[],
  home: Location,
  config: Config,
  strictMatrix: DistanceMatrix,
  precomputed?: Record<string, number>,
): Solution {
  const solution: Solution = [];
  let ptr = 0;

  while (ptr < tour.length) {
    const dayIndices: number[] = [];

    while (ptr < tour.length) {
      const proposed = [...dayIndices, tour[ptr]];
      const km = estimateRouteKm(proposed, locations, home, strictMatrix, precomputed);
      const hours = km / config.avgSpeed + proposed.length * config.visitTime / 60;

      let violation = false;
      switch (config.constraintType) {
        case "hours": if (hours > config.constraintValue) violation = true; break;
        case "visits": if (proposed.length > config.constraintValue || km / config.avgSpeed > 8) violation = true; break;
        case "hours+visits": if (km / config.avgSpeed > config.constraintValue || proposed.length > (config.maxVisits ?? 10)) violation = true; break;
      }
      if (violation) break;
      dayIndices.push(tour[ptr]);
      ptr++;
    }

    if (dayIndices.length === 0 && ptr < tour.length) {
      dayIndices.push(tour[ptr]);
      ptr++;
    }
    if (dayIndices.length > 0) {
      // Re-order within day using NN from home
      solution.push(nearestNeighborWithinDay(dayIndices, locations, home, strictMatrix, precomputed));
    }
  }

  return solution;
}

/** Estimate round-trip distance for a set of indices */
function estimateRouteKm(
  indices: number[],
  locations: Location[],
  home: Location,
  strictMatrix: DistanceMatrix,
  precomputed?: Record<string, number>,
): number {
  if (indices.length === 0) return 0;
  if (indices.length === 1) {
    return 2 * pd(indices[0], -1, precomputed, strictMatrix);
  }

  // Simple NN ordering estimate
  const unvisited = new Set(indices);
  let current = -1; // home
  let total = 0;

  while (unvisited.size > 0) {
    let nearest = -1;
    let minD = Infinity;
    for (const idx of unvisited) {
      const d = pd(current, idx, precomputed, strictMatrix);
      if (d < minD) {
        minD = d;
        nearest = idx;
      }
    }
    if (nearest === -1) break;
    total += minD;
    current = nearest;
    unvisited.delete(nearest);
  }

  total += pd(current, -1, precomputed, strictMatrix); // return home
  return total;
}

/** Nearest Neighbor ordering from home */
function nearestNeighborWithinDay(
  indices: number[],
  locations: Location[],
  home: Location,
  strictMatrix: DistanceMatrix,
  precomputed?: Record<string, number>,
): number[] {
  if (indices.length <= 1) return indices;
  const unvisited = new Set(indices);
  const ordered: number[] = [];
  let current = -1;
  let stuck = 0;
  while (unvisited.size > 0) {
    let nearest = -1; let minD = Infinity;
    for (const idx of unvisited) {
      const d = pd(current, idx, precomputed, strictMatrix);
      if (d < minD) { minD = d; nearest = idx; }
    }
    if (nearest === -1) {
      stuck++;
      if (stuck > indices.length + 1) break; // safety
      current = -1; // restart from home
      continue;
    }
    stuck = 0;
    ordered.push(nearest);
    current = nearest;
    unvisited.delete(nearest);
  }
  return ordered;
}

// ─── Step 3: Local Search ────────────────────────────────────

/** Compute total round-trip distance for a solution */
function solutionDistance(
  sol: Solution,
  locations: Location[],
  strictMatrix: DistanceMatrix,
  precomputed?: Record<string, number>,
): number {
  let total = 0;
  for (const day of sol) {
    if (day.length === 0) continue;
    // home → first
    total += pd(-1, day[0], precomputed, strictMatrix);
    // between stops
    for (let i = 1; i < day.length; i++) {
      total += pd(day[i - 1], day[i], precomputed, strictMatrix);
    }
    // last → home
    total += pd(day[day.length - 1], -1, precomputed, strictMatrix);
  }
  return total;
}

/** Check if a day's route violates the constraint */
function dayViolates(
  indices: number[],
  locations: Location[],
  home: Location,
  config: Config,
  strictMatrix: DistanceMatrix,
  precomputed?: Record<string, number>,
): boolean {
  if (indices.length === 0) return false;
  const km = solutionDistance([indices], locations, strictMatrix, precomputed);
  const hours = km / config.avgSpeed + indices.length * config.visitTime / 60;
  switch (config.constraintType) {
    case "hours": return hours > config.constraintValue;
    case "visits": return indices.length > config.constraintValue || km / config.avgSpeed > 8;
    case "hours+visits": return km / config.avgSpeed > config.constraintValue || indices.length > (config.maxVisits ?? 10);
  }
}

/**
 * Local search: try Relocate and Exchange moves to improve total distance.
 * Inspired by OR-Tools' local search operators.
 */
function localSearch(
  sol: Solution,
  locations: Location[],
  home: Location,
  config: Config,
  strictMatrix: DistanceMatrix,
  precomputed?: Record<string, number>,
): Solution {
  let best = sol.map(d => [...d]); // deep clone
  let bestDist = solutionDistance(best, locations, strictMatrix, precomputed);
  let improved = true;
  const MAX_ITER = 50;
  let iter = 0;

  while (improved && iter < MAX_ITER) {
    improved = false;
    iter++;

    // ── Relocate: move a location from one day to another ──
    for (let fromDay = 0; fromDay < best.length; fromDay++) {
      for (let fromPos = 0; fromPos < best[fromDay].length; fromPos++) {
        const loc = best[fromDay][fromPos];

        for (let toDay = 0; toDay < best.length; toDay++) {
          if (toDay === fromDay) continue;

          // Try inserting at every position in toDay
          for (let toPos = 0; toPos <= best[toDay].length; toPos++) {
            // Clone and apply
            const candidate = best.map(d => [...d]);
            candidate[fromDay].splice(fromPos, 1);
            candidate[toDay].splice(toPos, 0, loc);

            // Re-order both affected days with NN
            candidate[fromDay] = nearestNeighborWithinDay(candidate[fromDay], locations, home, strictMatrix, precomputed);
            candidate[toDay] = nearestNeighborWithinDay(candidate[toDay], locations, home, strictMatrix, precomputed);

            // Check constraints
            if (dayViolates(candidate[fromDay], locations, home, config, strictMatrix, precomputed)) continue;
            if (dayViolates(candidate[toDay], locations, home, config, strictMatrix, precomputed)) continue;

            const dist = solutionDistance(candidate, locations, strictMatrix, precomputed);
            if (dist < bestDist - 0.01) {
              best = candidate;
              bestDist = dist;
              improved = true;
              break; // restart loop
            }
          }
          if (improved) break;
        }
        if (improved) break;
      }
      if (improved) break;
    }

    if (improved) continue;

    // ── Exchange: swap two locations between days ──
    for (let dayA = 0; dayA < best.length; dayA++) {
      for (let posA = 0; posA < best[dayA].length; posA++) {
        for (let dayB = dayA + 1; dayB < best.length; dayB++) {
          for (let posB = 0; posB < best[dayB].length; posB++) {
            const candidate = best.map(d => [...d]);
            const tmpA = candidate[dayA][posA];
            const tmpB = candidate[dayB][posB];
            candidate[dayA][posA] = tmpB;
            candidate[dayB][posB] = tmpA;

            candidate[dayA] = nearestNeighborWithinDay(candidate[dayA], locations, home, strictMatrix, precomputed);
            candidate[dayB] = nearestNeighborWithinDay(candidate[dayB], locations, home, strictMatrix, precomputed);

            if (dayViolates(candidate[dayA], locations, home, config, strictMatrix, precomputed)) continue;
            if (dayViolates(candidate[dayB], locations, home, config, strictMatrix, precomputed)) continue;

            const dist = solutionDistance(candidate, locations, strictMatrix, precomputed);
            if (dist < bestDist - 0.01) {
              best = candidate;
              bestDist = dist;
              improved = true;
              break;
            }
          }
          if (improved) break;
        }
        if (improved) break;
      }
      if (improved) break;
    }
  }

  return best;
}

// ─── Convert Solution → DayRoute[] ──────────────────────────

function solutionToDays(
  sol: Solution,
  locations: Location[],
  home: Location,
  config: Config,
  strictMatrix: DistanceMatrix,
  precomputed?: Record<string, number>,
): DayRoute[] {
  return sol.map((ordered, dayIdx) => {
    const stops: Stop[] = [];
    let cumulativeDist = 0;
    let cumulativeTime = 0;

    stops.push({ sequence: 0, name: home.name, lat: home.lat, lng: home.lng,
      distanceFromPrev: 0, cumulativeDistance: 0, cumulativeTime: 0, isHome: true });

    for (let i = 0; i < ordered.length; i++) {
      const idx = ordered[i];
      const d = pd(i === 0 ? -1 : ordered[i - 1], idx, precomputed, strictMatrix);
      const t = d / config.avgSpeed;
      cumulativeDist += d;
      cumulativeTime += t + config.visitTime / 60;
      stops.push({ sequence: i + 1, name: locations[idx].name, lat: locations[idx].lat,
        lng: locations[idx].lng, distanceFromPrev: d, cumulativeDistance: cumulativeDist,
        cumulativeTime: cumulativeTime, isHome: false });
    }

    const returnDist = pd(ordered[ordered.length - 1], -1, precomputed, strictMatrix);
    cumulativeDist += returnDist;
    cumulativeTime += returnDist / config.avgSpeed;
    stops.push({ sequence: ordered.length + 1, name: home.name, lat: home.lat, lng: home.lng,
      distanceFromPrev: returnDist, cumulativeDistance: cumulativeDist,
      cumulativeTime: cumulativeTime, isHome: true });

    return { day: dayIdx + 1, stops, totalDistance: cumulativeDist,
      totalTime: cumulativeTime, totalStops: ordered.length };
  });
}

// ─── Edit-mode: reoptimize a single day ──────────────────────

/**
 * Re-optimize a single day's POIs from scratch.
 *
 * Used by the route editor on add/remove — instant feedback is critical
 * here (drag interactions), so we skip OSRM and use a fast NN + 2-opt
 * loop over the day's POI subset. The caller passes a precomputed
 * `matrix` together with a `nameToIndex` map; if both are present we
 * use the real distances, and we fall back to Haversine whenever a
 * pair is missing (e.g. a POI added via the editor that doesn't exist
 * in the original matrix) so the editor always renders.
 *
 * PR 6: when `strictMatrix` is also provided (in addition to `matrix`
 * and `nameToIndex`), the strict path is preferred — it reads per-pair
 * `MatrixEntry.source` so the editor can in principle surface the
 * source. Distance resolution still uses `entry.distance`; the source
 * is logged on miss for parity with the legacy path.
 *
 * The `nameToIndex` map is keyed by `Location.name` and uses the
 * matrix convention: 0 = home, 1..n = locations in array order.
 *
 * @param locations    POIs to visit on this day (order is ignored).
 * @param home         Start and end point of the day.
 * @param config       Used for avgSpeed + visitTime when computing
 *                     cumulative time on the returned DayRoute.
 * @param matrix       Optional precomputed real-distance matrix
 *                     ("i,j" → km). Used only when `nameToIndex` is
 *                     also provided.
 * @param dayNumber    1-based day number for the returned DayRoute.
 * @param nameToIndex  Optional map from location name → matrix index
 *                     (0 = home, 1..n = locations in array order).
 *                     Must agree with the matrix that was built from
 *                     `[home, ...locations]`.
 * @param strictMatrix Optional PR 6 `DistanceMatrix` (per-pair
 *                     `MatrixEntry`). When provided together with
 *                     `matrix` and `nameToIndex`, preferred over the
 *                     legacy path.
 * @returns            DayRoute with home → optimized POIs → home.
 */
export function reoptimizeDay(
  locations: Location[],
  home: Location,
  config: Config,
  matrix: Record<string, number> | undefined,
  dayNumber: number,
  nameToIndex?: Record<string, number>,
  strictMatrix?: DistanceMatrix
): DayRoute {
  // Empty day — just home at start and end.
  if (locations.length === 0) {
    const homeStop: Stop = {
      sequence: 0,
      name: home.name,
      lat: home.lat,
      lng: home.lng,
      distanceFromPrev: 0,
      cumulativeDistance: 0,
      cumulativeTime: 0,
      isHome: true,
    };
    return {
      day: dayNumber,
      stops: [homeStop],
      totalDistance: 0,
      totalTime: 0,
      totalStops: 0,
    };
  }

  // Distance: prefer the strict (PR 6) matrix when `strictMatrix`,
  // `matrix` and `nameToIndex` are all provided. Otherwise use the
  // legacy matrix path. Falls back to Haversine for missing pairs
  // (e.g. a POI added via the editor that doesn't exist in the original
  // matrix) so the editor always renders.
  const distance = (a: Location, b: Location): number => {
    if (matrix && nameToIndex) {
      const ia = nameToIndex[a.name];
      const ib = nameToIndex[b.name];
      if (ia !== undefined && ib !== undefined) {
        const key = ia < ib ? `${ia},${ib}` : `${ib},${ia}`;
        // Strict path (PR 6) — preferred when supplied.
        if (strictMatrix) {
          const entry = strictMatrix[key];
          if (entry !== undefined) return entry.distance;
        }
        // Legacy path — Record<string, number>.
        const v = matrix[key];
        if (v !== undefined) return v;
      }
    }
    // Fallback: Haversine (siempre disponible, sin API calls)
    return haversineDistance(a.lat, a.lng, b.lat, b.lng);
  };

  // ── Step 1: Nearest Neighbor from home ──
  const ordered: Location[] = [];
  const remaining = [...locations];
  let current: Location = home;

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = distance(current, remaining[0]);
    for (let i = 1; i < remaining.length; i++) {
      const d = distance(current, remaining[i]);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }
    const next = remaining.splice(nearestIdx, 1)[0];
    ordered.push(next);
    current = next;
  }

  // ── Step 2: 2-opt improvement (round-trip home → ... → home) ──
  const MAX_ITER = 50;
  let improved = true;
  let iter = 0;
  while (improved && iter < MAX_ITER && ordered.length >= 3) {
    improved = false;
    iter++;
    for (let i = 0; i < ordered.length - 2; i++) {
      for (let j = i + 2; j < ordered.length - 1; j++) {
        // Current edges: (i-1,i) and (j,j+1)  —  with home on both ends
        // We are swapping reverse(i+1..j) — measure only the changed
        // interior edges to keep this O(1) per move.
        const a = i === 0 ? home : ordered[i - 1];
        const b = ordered[i];
        const c = ordered[j];
        const d = j + 1 < ordered.length ? ordered[j + 1] : home;

        const before = distance(a, b) + distance(c, d);
        const after = distance(a, c) + distance(b, d);

        if (after + 1e-9 < before) {
          // Reverse the segment [i..j]
          let lo = i;
          let hi = j;
          while (lo < hi) {
            const tmp = ordered[lo];
            ordered[lo] = ordered[hi];
            ordered[hi] = tmp;
            lo++;
            hi--;
          }
          improved = true;
        }
      }
    }
  }
  // ── Step 3: Build the DayRoute ──
  const stops: Stop[] = [];
  let cumulativeDist = 0;
  let cumulativeTime = 0;

  stops.push({
    sequence: 0,
    name: home.name,
    lat: home.lat,
    lng: home.lng,
    distanceFromPrev: 0,
    cumulativeDistance: 0,
    cumulativeTime: 0,
    isHome: true,
  });

  for (let i = 0; i < ordered.length; i++) {
    const prev = i === 0 ? home : ordered[i - 1];
    const cur = ordered[i];
    const d = distance(prev, cur);
    const t = d / config.avgSpeed;
    cumulativeDist += d;
    cumulativeTime += t + config.visitTime / 60;
    stops.push({
      sequence: i + 1,
      name: cur.name,
      lat: cur.lat,
      lng: cur.lng,
      distanceFromPrev: d,
      cumulativeDistance: cumulativeDist,
      cumulativeTime: cumulativeTime,
      isHome: false,
    });
  }

  const returnDist = distance(ordered[ordered.length - 1], home);
  cumulativeDist += returnDist;
  cumulativeTime += returnDist / config.avgSpeed;
  stops.push({
    sequence: ordered.length + 1,
    name: home.name,
    lat: home.lat,
    lng: home.lng,
    distanceFromPrev: returnDist,
    cumulativeDistance: cumulativeDist,
    cumulativeTime: cumulativeTime,
    isHome: true,
  });

  return {
    day: dayNumber,
    stops,
    totalDistance: Math.round(cumulativeDist * 100) / 100,
    totalTime: Math.round(cumulativeTime * 100) / 100,
    totalStops: ordered.length,
  };
}
