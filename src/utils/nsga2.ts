/**
 * NSGA-II for Multi-Objective VRP.
 *
 * Chromosome: permutation of location indices (giant tour).
 * Decoder: splits the tour into daily routes based on constraint.
 * Objectives: (1) minimize total distance, (2) minimize number of days.
 * Constraint: max hours/visits/capacity per day.
 */

import { Location, Config, DayRoute, Stop } from "@/types";
import { haversineDistance } from "./haversine";

// ─── Types ───────────────────────────────────────────────────

interface Individual {
  /** Permutation of location indices (giant tour order) */
  perm: number[];
  /** Decoded daily routes (indices per day, in visit order) */
  routes: number[][];
  /** Objective values: [totalDistance, numberOfDays] */
  objectives: [number, number];
  /** NSGA-II: rank (Pareto front level) */
  rank: number;
  /** NSGA-II: crowding distance */
  crowdingDist: number;
}

interface NSGA2Params {
  populationSize: number;
  generations: number;
  crossoverRate: number;
  mutationRate: number;
  tournamentSize: number;
}

const DEFAULT_PARAMS: NSGA2Params = {
  populationSize: 100,
  generations: 150,
  crossoverRate: 0.8,
  mutationRate: 0.2,
  tournamentSize: 2,
};

// ─── Distance helper ─────────────────────────────────────────

let _locations: Location[] = [];
let _home: Location = { name: "Casa", lat: 0, lng: 0 };
let _config: Config = { homeLat: 0, homeLng: 0, constraintType: "hours", constraintValue: 8, avgSpeed: 60, visitTime: 30 };
let _precomputed: Record<string, number> | undefined;

function pd(a: number, b: number): number {
  const keyA = a === -1 ? 0 : a + 1;
  const keyB = b === -1 ? 0 : b + 1;
  const key = keyA < keyB ? `${keyA},${keyB}` : `${keyB},${keyA}`;
  if (_precomputed?.[key] !== undefined) return _precomputed[key];
  const lat1 = a === -1 ? _home.lat : _locations[a].lat;
  const lng1 = a === -1 ? _home.lng : _locations[a].lng;
  const lat2 = b === -1 ? _home.lat : _locations[b].lat;
  const lng2 = b === -1 ? _home.lng : _locations[b].lng;
  return haversineDistance(lat1, lng1, lat2, lng2);
}

function routeDistance(route: number[]): number {
  if (route.length === 0) return 0;
  let d = pd(-1, route[0]);
  for (let i = 1; i < route.length; i++) d += pd(route[i - 1], route[i]);
  d += pd(route[route.length - 1], -1);
  return d;
}

// ─── Decoder: permutation → daily routes ──────────────────

function decode(perm: number[]): number[][] {
  const routes: number[][] = [];
  let i = 0;

  while (i < perm.length) {
    const day: number[] = [];

    while (i < perm.length) {
      const proposed = [...day, perm[i]];
      const km = routeDistance(proposed);
      let violation = false;

      switch (_config.constraintType) {
        case "hours": {
          const h = km / _config.avgSpeed + proposed.length * _config.visitTime / 60;
          if (h > _config.constraintValue) violation = true;
          break;
        }
        case "visits": if (proposed.length > _config.constraintValue) violation = true; break;
        case "capacity": if (proposed.length > _config.constraintValue) violation = true; break;
      }

      if (violation) break;
      day.push(perm[i]);
      i++;
    }

    if (day.length === 0 && i < perm.length) {
      day.push(perm[i]);
      i++;
    }

    if (day.length > 0) routes.push(day);
    else i++;
  }

  return routes;
}

// ─── Compute objectives ──────────────────────────────────────

function computeObjectives(routes: number[][]): [number, number] {
  const totalDist = routes.reduce((s, r) => s + routeDistance(r), 0);
  return [totalDist, routes.length];
}

// ─── Random permutation ──────────────────────────────────────

function randomPermutation(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** NN heuristic permutation (greedy nearest neighbor from home) */
function nnPermutation(): number[] {
  const n = _locations.length;
  const visited = new Set<number>();
  const perm: number[] = [];
  let current = -1;
  while (visited.size < n) {
    let nearest = -1, minD = Infinity;
    for (let i = 0; i < n; i++) {
      if (visited.has(i)) continue;
      const d = pd(current, i);
      if (d < minD) { minD = d; nearest = i; }
    }
    if (nearest === -1) break;
    perm.push(nearest);
    visited.add(nearest);
    current = nearest;
  }
  return perm;
}

/** Create initial population: mix of NN heuristic + random */
function initPopulation(): Individual[] {
  const pop: Individual[] = [];
  const n = _locations.length;

  // 10% NN heuristic, 90% random
  const nnCount = Math.max(1, Math.floor(DEFAULT_PARAMS.populationSize * 0.1));

  for (let i = 0; i < DEFAULT_PARAMS.populationSize; i++) {
    const perm = i < nnCount ? nnPermutation() : randomPermutation(n);
    const routes = decode(perm);
    const objectives = computeObjectives(routes);
    pop.push({ perm, routes, objectives, rank: 0, crowdingDist: 0 });
  }

  return pop;
}

// ─── NSGA-II Core ────────────────────────────────────────────

function dominates(a: [number, number], b: [number, number]): boolean {
  // Both objectives are minimized
  const betterInOne = a[0] < b[0] || a[1] < b[1];
  const noWorse = a[0] <= b[0] && a[1] <= b[1];
  return betterInOne && noWorse;
}

function fastNonDominatedSort(pop: Individual[]): void {
  const n = pop.length;
  const dominationCount = new Array(n).fill(0);
  const dominated: number[][] = Array.from({ length: n }, () => []);
  const fronts: number[][] = [];

  for (let p = 0; p < n; p++) {
    for (let q = 0; q < n; q++) {
      if (p === q) continue;
      if (dominates(pop[p].objectives, pop[q].objectives)) {
        dominated[p].push(q);
      } else if (dominates(pop[q].objectives, pop[p].objectives)) {
        dominationCount[p]++;
      }
    }
    if (dominationCount[p] === 0) {
      pop[p].rank = 0;
      if (fronts[0] === undefined) fronts[0] = [];
      fronts[0].push(p);
    }
  }

  let i = 0;
  while (fronts[i] !== undefined) {
    const nextFront: number[] = [];
    for (const p of fronts[i]) {
      for (const q of dominated[p]) {
        dominationCount[q]--;
        if (dominationCount[q] === 0) {
          pop[q].rank = i + 1;
          nextFront.push(q);
        }
      }
    }
    if (nextFront.length > 0) fronts[i + 1] = nextFront;
    i++;
  }
}

function crowdingDistanceAssignment(pop: Individual[], front: number[]): void {
  const m = front.length;
  if (m <= 2) {
    for (const idx of front) pop[idx].crowdingDist = Infinity;
    return;
  }

  for (const idx of front) pop[idx].crowdingDist = 0;

  // For each objective
  for (const objIdx of [0, 1]) {
    front.sort((a, b) => pop[a].objectives[objIdx] - pop[b].objectives[objIdx]);
    const minVal = pop[front[0]].objectives[objIdx];
    const maxVal = pop[front[m - 1]].objectives[objIdx];
    const range = maxVal - minVal;
    if (range === 0) continue;

    pop[front[0]].crowdingDist = Infinity;
    pop[front[m - 1]].crowdingDist = Infinity;

    for (let i = 1; i < m - 1; i++) {
      const d = pop[front[i + 1]].objectives[objIdx] - pop[front[i - 1]].objectives[objIdx];
      pop[front[i]].crowdingDist += d / range;
    }
  }
}

// ─── Selection ───────────────────────────────────────────────

function tournamentSelect(pop: Individual[]): Individual {
  let best: Individual | null = null;
  for (let i = 0; i < DEFAULT_PARAMS.tournamentSize; i++) {
    const idx = Math.floor(Math.random() * pop.length);
    const candidate = pop[idx];
    if (best === null) { best = candidate; continue; }
    // Better rank wins
    if (candidate.rank < best.rank) { best = candidate; continue; }
    // Same rank → higher crowding distance
    if (candidate.rank === best.rank && candidate.crowdingDist > best.crowdingDist) {
      best = candidate;
    }
  }
  return { ...best!, perm: [...best!.perm], routes: best!.routes.map(r => [...r]) };
}

// ─── Crossover: Order Crossover (OX) ─────────────────────────

function crossover(p1: number[], p2: number[]): [number[], number[]] {
  const n = p1.length;
  const cut1 = Math.floor(Math.random() * (n - 1));
  const cut2 = cut1 + 1 + Math.floor(Math.random() * (n - cut1 - 1));

  // Child 1: take segment from p1, fill rest from p2 in order
  const child1 = new Array(n).fill(-1);
  const segment1 = new Set(p1.slice(cut1, cut2 + 1));
  let idx = 0;
  for (let i = cut1; i <= cut2; i++) child1[i] = p1[i];
  for (let i = 0; i < n; i++) {
    if (child1[i] !== -1) continue;
    while (segment1.has(p2[idx])) idx++;
    child1[i] = p2[idx++];
  }

  // Child 2: take segment from p2, fill rest from p1
  const child2 = new Array(n).fill(-1);
  const segment2 = new Set(p2.slice(cut1, cut2 + 1));
  idx = 0;
  for (let i = cut1; i <= cut2; i++) child2[i] = p2[i];
  for (let i = 0; i < n; i++) {
    if (child2[i] !== -1) continue;
    while (segment2.has(p1[idx])) idx++;
    child2[i] = p1[idx++];
  }

  return [child1, child2];
}

// ─── Mutation: Swap + Reverse ───────────────────────────────

function mutate(perm: number[]): number[] {
  const result = [...perm];
  if (Math.random() < 0.5 && result.length >= 2) {
    // Swap two random positions
    const i = Math.floor(Math.random() * result.length);
    let j = Math.floor(Math.random() * result.length);
    while (j === i) j = Math.floor(Math.random() * result.length);
    [result[i], result[j]] = [result[j], result[i]];
  } else if (result.length >= 3) {
    // Reverse a random segment
    const i = Math.floor(Math.random() * (result.length - 1));
    const j = i + 1 + Math.floor(Math.random() * (result.length - i - 1));
    let l = i, r = j;
    while (l < r) { [result[l], result[r]] = [result[r], result[l]]; l++; r--; }
  }
  return result;
}

// ─── Main NSGA-II Loop ───────────────────────────────────────

export interface ParetoSolution {
  days: number;
  totalDistance: number;
  routes: number[][];
  /** Converted to DayRoute[] for display */
  dayRoutes: DayRoute[];
}

export interface NSGAResult {
  /** Solution with minimum total distance */
  minDistance: ParetoSolution;
  /** Solution with fewest days */
  minDays: ParetoSolution;
  /** Best compromise: closest to (minDist+minDays)/2 */
  balanced: ParetoSolution;
  /** All Pareto solutions (for reference) */
  paretoFront: ParetoSolution[];
  generations: number;
  populationSize: number;
  _debug: {
    frontSize: number;
    uniqueDays: number[];
    uniqueDists: number[];
    minDist: { days: number; km: number };
    minDays: { days: number; km: number };
    balanced: { days: number; km: number };
  };
}

export function runNSGA2(
  locations: Location[],
  home: Location,
  config: Config,
  precomputed?: Record<string, number>,
  params: Partial<NSGA2Params> = {}
): NSGAResult {
  // Set globals
  _locations = locations;
  _home = home;
  _config = config;
  _precomputed = precomputed;

  const p = { ...DEFAULT_PARAMS, ...params };
  const n = locations.length;

  if (n === 0) {
    return { minDistance: { days: 0, totalDistance: 0, routes: [], dayRoutes: [] },
             minDays: { days: 0, totalDistance: 0, routes: [], dayRoutes: [] },
             balanced: { days: 0, totalDistance: 0, routes: [], dayRoutes: [] },
             paretoFront: [], generations: 0, populationSize: 0,
             _debug: { frontSize: 0, uniqueDays: [], uniqueDists: [], minDist: { days: 0, km: 0 }, minDays: { days: 0, km: 0 }, balanced: { days: 0, km: 0 } } };
  }

  // Initialize
  let pop = initPopulation();

  for (let gen = 0; gen < p.generations; gen++) {
    // Create offspring
    const offspring: Individual[] = [];

    while (offspring.length < p.populationSize) {
      const parent1 = tournamentSelect(pop);
      const parent2 = tournamentSelect(pop);

      let childPerm1: number[], childPerm2: number[];
      if (Math.random() < p.crossoverRate) {
        [childPerm1, childPerm2] = crossover(parent1.perm, parent2.perm);
      } else {
        childPerm1 = [...parent1.perm];
        childPerm2 = [...parent2.perm];
      }

      if (Math.random() < p.mutationRate) childPerm1 = mutate(childPerm1);
      if (Math.random() < p.mutationRate) childPerm2 = mutate(childPerm2);

      const routes1 = decode(childPerm1);
      const routes2 = decode(childPerm2);
      offspring.push({ perm: childPerm1, routes: routes1, objectives: computeObjectives(routes1), rank: 0, crowdingDist: 0 });
      if (offspring.length < p.populationSize) {
        offspring.push({ perm: childPerm2, routes: routes2, objectives: computeObjectives(routes2), rank: 0, crowdingDist: 0 });
      }
    }

    // Combine parent + offspring
    const combined = [...pop, ...offspring];

    // Non-dominated sort
    fastNonDominatedSort(combined);

    // Compute crowding distance per front
    const maxRank = Math.max(...combined.map(ind => ind.rank));
    const fronts: number[][] = Array.from({ length: maxRank + 1 }, () => []);
    for (let i = 0; i < combined.length; i++) {
      fronts[combined[i].rank].push(i);
    }
    for (const front of fronts) {
      if (front.length > 0) crowdingDistanceAssignment(combined, front);
    }

    // Select next generation (elitism)
    const next: Individual[] = [];
    let rank = 0;
    while (next.length + fronts[rank].length <= p.populationSize) {
      for (const idx of fronts[rank]) {
        next.push({ ...combined[idx], perm: [...combined[idx].perm], routes: combined[idx].routes.map(r => [...r]) });
      }
      rank++;
    }

    // Fill remaining with best crowding distance from current front
    if (next.length < p.populationSize && rank < fronts.length) {
      const remaining = fronts[rank]
        .map(idx => ({ idx, dist: combined[idx].crowdingDist }))
        .sort((a, b) => b.dist - a.dist);

      for (let i = 0; i < remaining.length && next.length < p.populationSize; i++) {
        const idx = remaining[i].idx;
        next.push({ ...combined[idx], perm: [...combined[idx].perm], routes: combined[idx].routes.map(r => [...r]) });
      }
    }

    pop = next;
  }

  // ── Extract Pareto front ──
  fastNonDominatedSort(pop);
  const pareto = pop.filter(ind => ind.rank === 0);
  pareto.sort((a, b) => a.objectives[1] - b.objectives[1]);

  // Convert to output format
  const front: ParetoSolution[] = pareto.map(ind => ({
    days: ind.objectives[1],
    totalDistance: Math.round(ind.objectives[0] * 100) / 100,
    routes: ind.routes,
    dayRoutes: routesToDayRoutes(ind.routes),
  }));

  // ── Select the 3 specific solutions ──
  // 1. Min distance
  const minDistance = front.reduce((a, b) => a.totalDistance < b.totalDistance ? a : b);

  // 2. Min days
  const minDays = front.reduce((a, b) => a.days < b.days ? a : b);

  // 3. Balanced: closest to (minDist + minDays) / 2 for both objectives
  const targetDist = (minDistance.totalDistance + front[0].totalDistance) / 2;
  const targetDays = (minDays.days + front[front.length - 1].days) / 2;
  const balanced = front.reduce((best, sol) => {
    const score = Math.abs(sol.totalDistance - targetDist) / targetDist +
                  Math.abs(sol.days - targetDays) / targetDays;
    const bestScore = Math.abs(best.totalDistance - targetDist) / targetDist +
                      Math.abs(best.days - targetDays) / targetDays;
    return score < bestScore ? sol : best;
  });

  // Debug: log the Pareto front diversity
  const uniqueDays = [...new Set(front.map(s => s.days))].sort((a, b) => a - b);
  const uniqueDist = [...new Set(front.map(s => Math.round(s.totalDistance / 10) * 10))].sort((a, b) => a - b);
  console.log(`[NSGA2] Front size: ${front.length}, Unique days: ${uniqueDays.join(",")}, Unique dists (by 10km): ${uniqueDist.join(",")}`);
  console.log(`[NSGA2] MinDist: ${minDistance.days}d ${minDistance.totalDistance.toFixed(0)}km`);
  console.log(`[NSGA2] MinDays: ${minDays.days}d ${minDays.totalDistance.toFixed(0)}km`);
  console.log(`[NSGA2] Balanced: ${balanced.days}d ${balanced.totalDistance.toFixed(0)}km`);

  return {
    minDistance,
    minDays,
    balanced,
    paretoFront: front.slice(0, 5),
    generations: p.generations,
    populationSize: p.populationSize,
    _debug: {
      frontSize: front.length,
      uniqueDays: uniqueDays,
      uniqueDists: uniqueDist,
      minDist: { days: minDistance.days, km: minDistance.totalDistance },
      minDays: { days: minDays.days, km: minDays.totalDistance },
      balanced: { days: balanced.days, km: balanced.totalDistance },
    },
  };
}

// ─── Convert routes to DayRoute ─────────────────────────────

function routesToDayRoutes(routes: number[][]): DayRoute[] {
  return routes.map((indices, dayIdx) => {
    const stops: Stop[] = [];
    let cumulativeDist = 0;
    let cumulativeTime = 0;

    stops.push({ sequence: 0, name: _home.name, lat: _home.lat, lng: _home.lng,
      distanceFromPrev: 0, cumulativeDistance: 0, cumulativeTime: 0, isHome: true });

    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      const d = i === 0 ? pd(-1, idx) : pd(indices[i - 1], idx);
      cumulativeDist += d;
      cumulativeTime += d / _config.avgSpeed + _config.visitTime / 60;
      stops.push({ sequence: i + 1, name: _locations[idx].name, lat: _locations[idx].lat,
        lng: _locations[idx].lng, distanceFromPrev: d, cumulativeDistance: cumulativeDist,
        cumulativeTime: cumulativeTime, isHome: false });
    }

    const ret = pd(indices[indices.length - 1], -1);
    cumulativeDist += ret;
    cumulativeTime += ret / _config.avgSpeed;
    stops.push({ sequence: indices.length + 1, name: _home.name, lat: _home.lat,
      lng: _home.lng, distanceFromPrev: ret, cumulativeDistance: cumulativeDist,
      cumulativeTime: cumulativeTime, isHome: true });

    return { day: dayIdx + 1, stops, totalDistance: cumulativeDist,
      totalTime: cumulativeTime, totalStops: indices.length };
  });
}
