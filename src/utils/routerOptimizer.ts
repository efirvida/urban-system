import { Location, Config, DayRoute, Stop } from "@/types";
import { haversineDistance } from "./haversine";
import { drivingDistance } from "./routing";

// ─── Internal types ───────────────────────────────────────────

interface SavingsPair {
  i: number;
  j: number;
  savings: number;
}

interface RouteCluster {
  indices: number[];
}

// ─── Distance cache ───────────────────────────────────────────

/**
 * Pre-computed distance matrix.
 * dist[i][j] = road distance between locations i and j (km).
 * Index -1 = home.
 */
class DistanceMatrix {
  private n: number;
  private d: number[][];
  private real: boolean[][]; // whether it's a real (OSRM) distance

  constructor(n: number) {
    this.n = n;
    this.d = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
    this.real = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(false));
  }

  private idx(locationIdx: number): number {
    return locationIdx + 1; // 0 → home (index -1 → 0), 1..n → 1..n
  }

  async set(
    coords: { lat: number; lng: number }[],
    i: number,
    j: number
  ): Promise<void> {
    const a = this.idx(i);
    const b = this.idx(j);
    const p1 = i === -1 ? coords[0] : coords[i]; // home is first
    const p2 = j === -1 ? coords[0] : coords[j]; // home is first

    // For tiny distances (same point), Haversine is fine
    const H = haversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);
    if (H < 0.01) {
      this.d[a][b] = H;
      this.d[b][a] = H;
      return;
    }

    const real = await drivingDistance(p1.lat, p1.lng, p2.lat, p2.lng);
    const isReal = Math.abs(real - H) > 0.1;

    this.d[a][b] = real;
    this.d[b][a] = real;
    this.real[a][b] = isReal;
    this.real[b][a] = isReal;
  }

  get(i: number, j: number): number {
    return this.d[this.idx(i)][this.idx(j)];
  }

  isReal(i: number, j: number): boolean {
    return this.real[this.idx(i)][this.idx(j)];
  }

  /** Load from a pre-computed map: "i,j" → km, where 0=home, 1..n=locations */
  loadFromMap(map: Record<string, number>, n: number): void {
    for (const [key, value] of Object.entries(map)) {
      const [a, b] = key.split(",").map(Number);
      if (isNaN(a) || isNaN(b)) continue;
      // Convert from 0=home to -1=home
      const i = a === 0 ? -1 : a - 1;
      const j = b === 0 ? -1 : b - 1;
      const ai = this.idx(i);
      const bj = this.idx(j);
      if (ai < 0 || ai > n || bj < 0 || bj > n) continue;
      this.d[ai][bj] = value;
      this.d[bj][ai] = value;
      // Mark all as real — the client already distinguished
      this.real[ai][bj] = true;
      this.real[bj][ai] = true;
    }
  }
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Main entry point — async version that uses road distances.
 */
/**
 * Main entry point — async version that uses road distances.
 * If `precomputedMatrix` is provided (from client-side OSRM), uses that
 * instead of server-side routing calls.
 */
export async function optimizeRoutes(
  locations: Location[],
  config: Config,
  precomputedMatrix?: Record<string, number>
): Promise<{ days: DayRoute[]; totalDistance: number; osrmPairs: number; totalPairs: number }> {
  if (locations.length === 0) {
    return { days: [], totalDistance: 0, osrmPairs: 0, totalPairs: 0 };
  }

  const home: Location = {
    name: "Casa",
    lat: config.homeLat,
    lng: config.homeLng,
  };

  const allCoords = [home, ...locations];

  // ── Build distance matrix ──
  const matrix = new DistanceMatrix(locations.length);
  const totalPairs = (locations.length * (locations.length + 1)) / 2;

  if (precomputedMatrix && Object.keys(precomputedMatrix).length > 0) {
    // Use pre-computed matrix from client
    // Keys are "i,j" where 0=home, 1..n=locations
    matrix.loadFromMap(precomputedMatrix, locations.length);
  } else {
    // Fall back to server-side computation
    for (let i = 0; i < locations.length; i++) {
      await matrix.set(allCoords, -1, i);
    }
    for (let i = 0; i < locations.length; i++) {
      for (let j = i + 1; j < locations.length; j++) {
        await matrix.set(allCoords, i, j);
      }
    }
  }

  // Count real vs estimated
  let osrmPairs = 0;
  for (let i = -1; i < locations.length; i++) {
    for (let j = i + 1; j < locations.length; j++) {
      if (i === -1 && j === -1) continue;
      if (matrix.isReal(i, j)) osrmPairs++;
    }
  }

  // ── Algorithm ──
  const savings = calculateSavings(locations, matrix);
  const clusters = buildClusters(locations, home, matrix, savings, config);
  const days = orderClusters(clusters, locations, home, config, matrix);

  const totalDistance = days.reduce((sum, d) => sum + d.totalDistance, 0);

  return { days, totalDistance, osrmPairs, totalPairs };
}

// ─── Step 1: Savings ─────────────────────────────────────────

function calculateSavings(locations: Location[], matrix: DistanceMatrix): SavingsPair[] {
  const pairs: SavingsPair[] = [];

  for (let i = 0; i < locations.length; i++) {
    for (let j = i + 1; j < locations.length; j++) {
      const dHomeToI = matrix.get(-1, i);
      const dHomeToJ = matrix.get(-1, j);
      const dIToJ = matrix.get(i, j);
      const savings = dHomeToI + dHomeToJ - dIToJ;
      pairs.push({ i, j, savings });
    }
  }

  pairs.sort((a, b) => b.savings - a.savings);
  return pairs;
}

// ─── Step 2: Clusters ────────────────────────────────────────

function buildClusters(
  locations: Location[],
  home: Location,
  matrix: DistanceMatrix,
  savings: SavingsPair[],
  config: Config
): RouteCluster[] {
  const n = locations.length;
  const assignment = new Array<number>(n).fill(-1);
  const clusters: RouteCluster[] = [];

  for (const pair of savings) {
    const assignedI = assignment[pair.i];
    const assignedJ = assignment[pair.j];

    if (assignedI === -1 && assignedJ === -1) {
      const cluster: RouteCluster = { indices: [pair.i, pair.j] };
      if (!wouldViolateCluster(cluster, locations, home, matrix, config)) {
        clusters.push(cluster);
        assignment[pair.i] = clusters.length - 1;
        assignment[pair.j] = clusters.length - 1;
      }
    } else if (assignedI !== -1 && assignedJ === -1) {
      const cluster = clusters[assignedI];
      if (!wouldViolateAddition(cluster, pair.j, locations, home, matrix, config)) {
        cluster.indices.push(pair.j);
        assignment[pair.j] = assignedI;
      }
    } else if (assignedI === -1 && assignedJ !== -1) {
      const cluster = clusters[assignedJ];
      if (!wouldViolateAddition(cluster, pair.i, locations, home, matrix, config)) {
        cluster.indices.push(pair.i);
        assignment[pair.i] = assignedJ;
      }
    }
  }

  // Unassigned → solo clusters
  for (let i = 0; i < n; i++) {
    if (assignment[i] === -1) {
      clusters.push({ indices: [i] });
      assignment[i] = clusters.length - 1;
    }
  }

  return clusters;
}

// ─── Constraint checks ───────────────────────────────────────

function estimateRouteKm(
  indices: number[],
  locations: Location[],
  home: Location,
  matrix: DistanceMatrix
): number {
  if (indices.length === 0) return 0;
  if (indices.length === 1) {
    return matrix.get(-1, indices[0]) * 2; // home → loc → home
  }

  const distsFromHome = indices.map((idx) => matrix.get(-1, idx));
  const farthest = Math.max(...distsFromHome);
  const nearest = Math.min(...distsFromHome);

  let internal = 0;
  for (let k = 0; k < indices.length - 1; k++) {
    internal += matrix.get(indices[k], indices[k + 1]);
  }

  return farthest + internal + nearest;
}

function wouldViolateCluster(
  cluster: RouteCluster,
  locations: Location[],
  home: Location,
  matrix: DistanceMatrix,
  config: Config
): boolean {
  return checkConstraint(estimateRouteKm(cluster.indices, locations, home, matrix), cluster.indices.length, config);
}

function wouldViolateAddition(
  cluster: RouteCluster,
  newIdx: number,
  locations: Location[],
  home: Location,
  matrix: DistanceMatrix,
  config: Config
): boolean {
  const proposed = [...cluster.indices, newIdx];
  return checkConstraint(estimateRouteKm(proposed, locations, home, matrix), proposed.length, config);
}

function checkConstraint(km: number, stops: number, config: Config): boolean {
  switch (config.constraintType) {
    case "hours": {
      const travelHours = km / config.avgSpeed;
      const visitHours = (stops * config.visitTime) / 60;
      return travelHours + visitHours > config.constraintValue;
    }
    case "visits":
      return stops > config.constraintValue;
    case "capacity":
      return stops > config.constraintValue;
    default:
      return false;
  }
}

// ─── Step 3: Intra-route ordering ────────────────────────────

function orderClusters(
  clusters: RouteCluster[],
  locations: Location[],
  home: Location,
  config: Config,
  matrix: DistanceMatrix
): DayRoute[] {
  return clusters.map((cluster, dayIdx) => {
    const ordered = nearestNeighbor(cluster.indices, locations, home, matrix);

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

    let prevIdx = -1; // home

    for (const idx of ordered) {
      const d = matrix.get(prevIdx, idx);
      const t = d / config.avgSpeed;
      cumulativeDist += d;
      cumulativeTime += t + config.visitTime / 60;

      stops.push({
        sequence: stops.length,
        name: locations[idx].name,
        lat: locations[idx].lat,
        lng: locations[idx].lng,
        distanceFromPrev: d,
        cumulativeDistance: cumulativeDist,
        cumulativeTime: cumulativeTime,
        isHome: false,
      });

      prevIdx = idx;
    }

    // Return to home
    const returnDist = matrix.get(prevIdx, -1);
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

    return {
      day: dayIdx + 1,
      stops,
      totalDistance: cumulativeDist,
      totalTime: cumulativeTime,
      totalStops: ordered.length,
    };
  });
}

function nearestNeighbor(
  indices: number[],
  locations: Location[],
  home: Location,
  matrix: DistanceMatrix
): number[] {
  if (indices.length <= 1) return indices;

  const unvisited = new Set(indices);
  const ordered: number[] = [];
  let currentIdx = -1; // home

  while (unvisited.size > 0) {
    let nearest: number | null = null;
    let nearestDist = Infinity;

    for (const idx of unvisited) {
      const d = matrix.get(currentIdx, idx);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = idx;
      }
    }

    if (nearest !== null) {
      ordered.push(nearest);
      currentIdx = nearest;
      unvisited.delete(nearest);
    }
  }

  return ordered;
}
