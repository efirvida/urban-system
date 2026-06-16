import { Location, Config, DayRoute, Stop } from "@/types";
import { haversineDistance } from "./haversine";
import { drivingDistance } from "./routing";

// ─── Distance cache ───────────────────────────────────────────

/**
 * Internal distance function: uses precomputed matrix when available,
 * falls back to drivingDistance (OSRM), then Haversine.
 */
async function getDist(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
  precomputed?: Record<string, number>,
  i?: number, j?: number
): Promise<number> {
  // Try precomputed matrix first (by index when available)
  if (precomputed && i !== undefined && j !== undefined) {
    const a = i === -1 ? 0 : i + 1;
    const b = j === -1 ? 0 : j + 1;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    const val = precomputed[key];
    if (val !== undefined) return val;
  }

  // Try OSRM
  try {
    const real = await drivingDistance(lat1, lng1, lat2, lng2);
    if (real > 0) return real;
  } catch {}

  // Fallback to Haversine
  return haversineDistance(lat1, lng1, lat2, lng2);
}

// ─── Main entry point ────────────────────────────────────────

export async function optimizeRoutes(
  locations: Location[],
  config: Config,
  precomputedMatrix?: Record<string, number>
): Promise<{
  days: DayRoute[];
  totalDistance: number;
  osrmPairs: number;
  totalPairs: number;
}> {
  if (locations.length === 0) {
    return { days: [], totalDistance: 0, osrmPairs: 0, totalPairs: 0 };
  }

  const home: Location = {
    name: "Casa",
    lat: config.homeLat,
    lng: config.homeLng,
  };

  // ── Step 1: Build a giant TSP tour ──
  // Nearest Neighbor + 2-opt improvement
  const tour = await buildGiantTour(locations, home, config, precomputedMatrix);

  // ── Step 2: Slice the tour into daily segments ──
  const days = sliceTour(tour, locations, home, config, precomputedMatrix);

  const totalDistance = days.reduce((sum, d) => sum + d.totalDistance, 0);

  return {
    days,
    totalDistance,
    osrmPairs: precomputedMatrix ? Object.keys(precomputedMatrix).length : 0,
    totalPairs: (locations.length * (locations.length + 1)) / 2,
  };
}

// ─── Step 1: Giant TSP Tour ──────────────────────────────────

async function buildGiantTour(
  locations: Location[],
  home: Location,
  config: Config,
  precomputed?: Record<string, number>
): Promise<number[]> {
  // Nearest Neighbor
  const n = locations.length;
  const visited = new Set<number>();
  const tour: number[] = [];

  let currentLat = home.lat;
  let currentLng = home.lng;

  while (visited.size < n) {
    let nearest = -1;
    let nearestDist = Infinity;

    for (let i = 0; i < n; i++) {
      if (visited.has(i)) continue;
      const d = await getDist(
        currentLat, currentLng,
        locations[i].lat, locations[i].lng,
        precomputed, -1, i
      );
      if (d < nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    }

    if (nearest === -1) break;

    tour.push(nearest);
    visited.add(nearest);
    currentLat = locations[nearest].lat;
    currentLng = locations[nearest].lng;
  }

  // 2-opt improvement
  improveTour2Opt(tour, locations, precomputed);

  return tour;
}

// ─── 2-opt improvement ───────────────────────────────────────

function tourDist(
  tour: number[],
  locations: Location[],
  precomputed?: Record<string, number>
): number {
  if (tour.length <= 1) return 0;
  let total = 0;
  for (let i = 0; i < tour.length - 1; i++) {
    total += pairDist(tour[i], tour[i + 1], locations, precomputed);
  }
  return total;
}

function pairDist(
  a: number, b: number,
  locations: Location[],
  precomputed?: Record<string, number>
): number {
  const ai = a === -1 ? -1 : a;
  const bj = b === -1 ? -1 : b;
  if (precomputed) {
    const keyA = ai === -1 ? 0 : ai + 1;
    const keyB = bj === -1 ? 0 : bj + 1;
    const key = keyA < keyB ? `${keyA},${keyB}` : `${keyB},${keyA}`;
    const val = precomputed[key];
    if (val !== undefined) return val;
  }
  return haversineDistance(
    ai === -1 ? 0 : locations[ai].lat,
    ai === -1 ? 0 : locations[ai].lng,
    bj === -1 ? 0 : locations[bj].lat,
    bj === -1 ? 0 : locations[bj].lng
  );
}

function improveTour2Opt(
  tour: number[],
  locations: Location[],
  precomputed?: Record<string, number>
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
        const d1 = pairDist(tour[i], tour[i + 1], locations, precomputed);
        const d2 = pairDist(tour[j], tour[j + 1], locations, precomputed);
        // Proposed edges: (i, j) and (i+1, j+1)
        const d3 = pairDist(tour[i], tour[j], locations, precomputed);
        const d4 = pairDist(tour[i + 1], tour[j + 1], locations, precomputed);

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

// ─── Step 2: Slice Tour into Days ────────────────────────────

function sliceTour(
  tour: number[],
  locations: Location[],
  home: Location,
  config: Config,
  precomputed?: Record<string, number>
): DayRoute[] {
  const days: DayRoute[] = [];
  let dayIdx = 0;
  let ptr = 0;

  while (ptr < tour.length) {
    dayIdx++;
    const stops: Stop[] = [];
    let cumulativeDist = 0;
    let cumulativeTime = 0;
    const nStops: number[] = [];

    // Start at home
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

    let prevLat = home.lat;
    let prevLng = home.lng;

    while (ptr < tour.length) {
      const locIdx = tour[ptr];
      const loc = locations[locIdx];
      const dSegment = pairDist(
        nStops.length === 0 ? -1 : nStops[nStops.length - 1],
        locIdx,
        locations,
        precomputed
      );

      // Calculate what the round trip would look like
      const proposedKm = cumulativeDist + dSegment + pairDist(locIdx, -1, locations, precomputed);
      const proposedStops = nStops.length + 1;
      const proposedHours = proposedKm / config.avgSpeed + proposedStops * config.visitTime / 60;

      let violation = false;
      switch (config.constraintType) {
        case "hours":
          if (proposedHours > config.constraintValue) violation = true;
          break;
        case "visits":
          if (proposedStops > config.constraintValue) violation = true;
          break;
        case "capacity":
          if (proposedStops > config.constraintValue) violation = true;
          break;
      }

      if (violation) break;

      // Add to current day
      const t = dSegment / config.avgSpeed;
      cumulativeDist += dSegment;
      cumulativeTime += t + config.visitTime / 60;
      nStops.push(locIdx);

      stops.push({
        sequence: stops.length,
        name: loc.name,
        lat: loc.lat,
        lng: loc.lng,
        distanceFromPrev: dSegment,
        cumulativeDistance: cumulativeDist,
        cumulativeTime: cumulativeTime,
        isHome: false,
      });

      prevLat = loc.lat;
      prevLng = loc.lng;
      ptr++;
    }

    // Return to home (only if we visited at least one stop)
    if (nStops.length === 0) {
      // Edge case: single location doesn't fit the constraint
      // Force-add it anyway
      const forcedIdx = tour[ptr];
      const forcedLoc = locations[forcedIdx];
      const dSeg = haversineDistance(home.lat, home.lng, forcedLoc.lat, forcedLoc.lng);
      cumulativeDist = dSeg;
      cumulativeTime = dSeg / config.avgSpeed + config.visitTime / 60;
      nStops.push(forcedIdx);
      stops.push({
        sequence: 1,
        name: forcedLoc.name,
        lat: forcedLoc.lat,
        lng: forcedLoc.lng,
        distanceFromPrev: dSeg,
        cumulativeDistance: cumulativeDist,
        cumulativeTime: cumulativeTime,
        isHome: false,
      });
      ptr++;
    }

    const returnDist = pairDist(nStops[nStops.length - 1], -1, locations, precomputed);
    const returnTime = returnDist / config.avgSpeed;
    cumulativeDist += returnDist;
    cumulativeTime += returnTime;

    stops.push({
      sequence: stops.length,
      name: home.name,
      lat: home.lat,
      lng: home.lng,
      distanceFromPrev: returnDist,
      cumulativeDistance: cumulativeDist,
      cumulativeTime: cumulativeTime,
      isHome: true,
    });

    days.push({
      day: dayIdx,
      stops,
      totalDistance: cumulativeDist,
      totalTime: cumulativeTime,
      totalStops: nStops.length,
    });
  }

  return days;
}
