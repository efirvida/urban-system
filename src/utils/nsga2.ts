/**
 * NSGA-II for Multi-Objective VRP.
 *
 * Objectives:
 *   1. Minimize TOTAL DISTANCE (km)
 *   2. Minimize MAX DAY DURATION (hours) — the longest single day
 *
 * These genuinely conflict:
 *   - Short days → more days → more return trips → more total distance
 *   - Compact days → fewer days → less total distance → but some days are longer
 *
 * Chromosome: permutation of location indices (giant tour) + loadFactor (0.5-1.0)
 * Load factor controls how much of the daily constraint to use.
 */

import { Location, Config, DayRoute, Stop } from "@/types";
import { haversineDistance } from "./haversine";

// ─── Types ───────────────────────────────────────────────────

interface Individual {
  perm: number[];
  loadFactor: number;
  routes: number[][];
  /** [totalDistance, maxDayDuration] */
  objectives: [number, number];
  rank: number;
  crowdingDist: number;
}

interface NSGA2Params {
  populationSize: number;
  generations: number;
  crossoverRate: number;
  mutationRate: number;
}

const PARAMS: NSGA2Params = {
  populationSize: 120,
  generations: 200,
  crossoverRate: 0.85,
  mutationRate: 0.2,
};

// ─── Globals (set per run) ──────────────────────────────────

let _locs: Location[] = [];
let _home = { lat: 0, lng: 0 };
let _cfg: Config = { homeLat: 0, homeLng: 0, constraintType: "hours", constraintValue: 8, avgSpeed: 60, visitTime: 30 };
let _pre: Record<string, number> | undefined;

// ─── Distance helpers ────────────────────────────────────────

function pd(a: number, b: number): number {
  const ka = a === -1 ? 0 : a + 1;
  const kb = b === -1 ? 0 : b + 1;
  const k = ka < kb ? `${ka},${kb}` : `${kb},${ka}`;
  if (_pre?.[k] !== undefined) return _pre[k];
  return haversineDistance(
    a === -1 ? _home.lat : _locs[a].lat,
    a === -1 ? _home.lng : _locs[a].lng,
    b === -1 ? _home.lat : _locs[b].lat,
    b === -1 ? _home.lng : _locs[b].lng
  );
}

function routeDist(route: number[]): number {
  if (!route.length) return 0;
  let d = pd(-1, route[0]);
  for (let i = 1; i < route.length; i++) d += pd(route[i - 1], route[i]);
  d += pd(route[route.length - 1], -1);
  return d;
}

function routeHours(route: number[]): number {
  return routeDist(route) / _cfg.avgSpeed + route.length * _cfg.visitTime / 60;
}

// ─── Decoder ────────────────────────────────────────────────

function decode(perm: number[], lf: number): number[][] {
  const routes: number[][] = [];
  let i = 0;
  const maxH = _cfg.constraintValue * lf;

  while (i < perm.length) {
    const day: number[] = [];
    while (i < perm.length) {
      const prop = [...day, perm[i]];
      if (routeHours(prop) > maxH) break;
      day.push(perm[i]); i++;
    }
    if (day.length === 0 && i < perm.length) { day.push(perm[i]); i++; }
    if (day.length > 0) {
      // NN reorder within day
      const uv = new Set(day);
      const ord: number[] = [];
      let cur = -1;
      while (uv.size > 0) {
        let n = -1, md = Infinity;
        for (const idx of uv) { const d = pd(cur, idx); if (d < md) { md = d; n = idx; } }
        if (n === -1) break;
        ord.push(n); cur = n; uv.delete(n);
      }
      routes.push(ord);
    } else i++;
  }
  return routes;
}

function computeObjectives(routes: number[][]): [number, number] {
  const totalDist = routes.reduce((s, r) => s + routeDist(r), 0);
  const maxDur = Math.max(...routes.map(r => routeHours(r)), 0);
  return [totalDist, maxDur];
}

// ─── Initialization ─────────────────────────────────────────

function nnPermutation(): number[] {
  const n = _locs.length;
  const v = new Set<number>();
  const p: number[] = [];
  let cur = -1;
  while (v.size < n) {
    let nn = -1, md = Infinity;
    for (let i = 0; i < n; i++) {
      if (v.has(i)) continue;
      const d = pd(cur, i);
      if (d < md) { md = d; nn = i; }
    }
    if (nn === -1) break;
    p.push(nn); v.add(nn); cur = nn;
  }
  return p;
}

function randomPerm(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function initPopulation(): Individual[] {
  const pop: Individual[] = [];
  const n = _locs.length;
  const nnCount = Math.max(2, Math.floor(PARAMS.populationSize * 0.1));

  for (let i = 0; i < PARAMS.populationSize; i++) {
    const perm = i < nnCount ? nnPermutation() : randomPerm(n);
    // Evenly spaced load factors for max diversity
    const lf = 0.5 + (i / PARAMS.populationSize) * 0.5;
    const routes = decode(perm, lf);
    pop.push({ perm, loadFactor: lf, routes, objectives: computeObjectives(routes), rank: 0, crowdingDist: 0 });
  }
  return pop;
}

// ─── NSGA-II Core ────────────────────────────────────────────

function dominates(a: [number, number], b: [number, number]): boolean {
  return (a[0] <= b[0] && a[1] <= b[1] && (a[0] < b[0] || a[1] < b[1]));
}

function fastNonDominatedSort(pop: Individual[]): void {
  const n = pop.length;
  const count = new Array(n).fill(0);
  const dom: number[][] = Array.from({ length: n }, () => []);

  for (let p = 0; p < n; p++) {
    for (let q = 0; q < n; q++) {
      if (p === q) continue;
      if (dominates(pop[p].objectives, pop[q].objectives)) dom[p].push(q);
      else if (dominates(pop[q].objectives, pop[p].objectives)) count[p]++;
    }
  }

  const fronts: number[][] = [];
  for (let p = 0; p < n; p++) {
    if (count[p] === 0) {
      pop[p].rank = 0;
      if (!fronts[0]) fronts[0] = [];
      fronts[0].push(p);
    }
  }

  let i = 0;
  while (fronts[i]) {
    const next: number[] = [];
    for (const p of fronts[i]) {
      for (const q of dom[p]) {
        count[q]--;
        if (count[q] === 0) { pop[q].rank = i + 1; next.push(q); }
      }
    }
    if (next.length > 0) fronts[i + 1] = next;
    i++;
  }
}

function crowdingDistance(pop: Individual[], front: number[]): void {
  const m = front.length;
  if (m <= 2) { for (const idx of front) pop[idx].crowdingDist = Infinity; return; }
  for (const idx of front) pop[idx].crowdingDist = 0;

  for (const objIdx of [0, 1]) {
    front.sort((a, b) => pop[a].objectives[objIdx] - pop[b].objectives[objIdx]);
    const range = pop[front[m - 1]].objectives[objIdx] - pop[front[0]].objectives[objIdx];
    if (range === 0) continue;
    pop[front[0]].crowdingDist = Infinity;
    pop[front[m - 1]].crowdingDist = Infinity;
    for (let i = 1; i < m - 1; i++) {
      pop[front[i]].crowdingDist += (pop[front[i + 1]].objectives[objIdx] - pop[front[i - 1]].objectives[objIdx]) / range;
    }
  }
}

function tournamentSelect(pop: Individual[]): Individual {
  let best: Individual | null = null;
  for (let i = 0; i < 2; i++) {
    const idx = Math.floor(Math.random() * pop.length);
    const c = pop[idx];
    if (!best || c.rank < best.rank || (c.rank === best.rank && c.crowdingDist > best.crowdingDist)) {
      best = c;
    }
  }
  return { ...best!, perm: [...best!.perm], routes: best!.routes.map(r => [...r]) };
}

// ─── Crossover + Mutation ────────────────────────────────────

function orderCrossover(p1: number[], p2: number[]): [number[], number[]] {
  const n = p1.length;
  const c1 = Math.floor(Math.random() * (n - 1));
  const c2 = c1 + 1 + Math.floor(Math.random() * (n - c1 - 1));

  const ch1 = new Array(n).fill(-1), ch2 = new Array(n).fill(-1);
  const s1 = new Set(p1.slice(c1, c2 + 1));

  for (let i = c1; i <= c2; i++) ch1[i] = p1[i];
  let idx = 0;
  for (let i = 0; i < n; i++) { if (ch1[i] !== -1) continue; while (s1.has(p2[idx])) idx++; ch1[i] = p2[idx++]; }

  return [ch1, ch2];
}

function mutate(perm: number[]): number[] {
  const r = [...perm];
  if (r.length >= 2) {
    const i = Math.floor(Math.random() * r.length);
    let j = Math.floor(Math.random() * r.length);
    while (j === i) j = Math.floor(Math.random() * r.length);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

// ─── Main ────────────────────────────────────────────────────

export interface ParetoSolution {
  days: number;
  totalDistance: number;
  maxDayHours: number;
  routes: number[][];
  dayRoutes: DayRoute[];
}

export interface NSGAResult {
  /** Best compromise: closest to ideal point */
  balanced: ParetoSolution;
  /** Minimum total distance */
  minDistance: ParetoSolution;
  /** Minimum max day duration */
  minDuration: ParetoSolution;
  /** All non-dominated solutions found */
  paretoFront: ParetoSolution[];
  totalEvaluations: number;
}

export function runNSGA2(
  locations: Location[],
  home: Location,
  config: Config,
  precomputed?: Record<string, number>
): NSGAResult {
  _locs = locations;
  _home = home;
  _cfg = config;
  _pre = precomputed;

  const n = locations.length;
  if (n < 3) {
    const empty = { days: 0, totalDistance: 0, maxDayHours: 0, routes: [], dayRoutes: [] };
    return { balanced: empty, minDistance: empty, minDuration: empty, paretoFront: [], totalEvaluations: 0 };
  }

  // Initialize
  let pop = initPopulation();
  let evals = PARAMS.populationSize;

  for (let gen = 0; gen < PARAMS.generations; gen++) {
    const offspring: Individual[] = [];

    while (offspring.length < PARAMS.populationSize) {
      const p1 = tournamentSelect(pop);
      const p2 = tournamentSelect(pop);

      let c1: number[], c2: number[];
      let lf1 = p1.loadFactor, lf2 = p2.loadFactor;

      if (Math.random() < PARAMS.crossoverRate) {
        [c1, c2] = orderCrossover(p1.perm, p2.perm);
        const a = Math.random();
        lf1 = a * p1.loadFactor + (1 - a) * p2.loadFactor;
        lf2 = (1 - a) * p1.loadFactor + a * p2.loadFactor;
      } else {
        c1 = [...p1.perm]; c2 = [...p2.perm];
      }

      if (Math.random() < PARAMS.mutationRate) c1 = mutate(c1);
      if (Math.random() < PARAMS.mutationRate) c2 = mutate(c2);
      if (Math.random() < PARAMS.mutationRate) lf1 = Math.max(0.4, Math.min(1.0, lf1 + (Math.random() - 0.5) * 0.2));
      if (Math.random() < PARAMS.mutationRate) lf2 = Math.max(0.4, Math.min(1.0, lf2 + (Math.random() - 0.5) * 0.2));

      const r1 = decode(c1, lf1);
      const r2 = decode(c2, lf2);
      offspring.push({ perm: c1, loadFactor: lf1, routes: r1, objectives: computeObjectives(r1), rank: 0, crowdingDist: 0 });
      if (offspring.length < PARAMS.populationSize) {
        offspring.push({ perm: c2, loadFactor: lf2, routes: r2, objectives: computeObjectives(r2), rank: 0, crowdingDist: 0 });
      }
    }

    evals += offspring.length;

    // Combine + non-dominated sort
    const combined = [...pop, ...offspring];
    fastNonDominatedSort(combined);

    // Crowding distance per front
    const maxRank = Math.max(...combined.map(ind => ind.rank));
    const fronts: number[][] = Array.from({ length: maxRank + 1 }, () => []);
    for (let i = 0; i < combined.length; i++) fronts[combined[i].rank].push(i);
    for (const f of fronts) { if (f.length > 0) crowdingDistance(combined, f); }

    // Select next generation
    const next: Individual[] = [];
    let r = 0;
    while (r < fronts.length && next.length + fronts[r].length <= PARAMS.populationSize) {
      for (const idx of fronts[r]) next.push({ ...combined[idx], perm: [...combined[idx].perm], routes: combined[idx].routes.map(x => [...x]) });
      r++;
    }
    if (next.length < PARAMS.populationSize && r < fronts.length) {
      const remaining = fronts[r].map(idx => ({ idx, dist: combined[idx].crowdingDist })).sort((a, b) => b.dist - a.dist);
      for (let i = 0; i < remaining.length && next.length < PARAMS.populationSize; i++) {
        const idx = remaining[i].idx;
        next.push({ ...combined[idx], perm: [...combined[idx].perm], routes: combined[idx].routes.map(x => [...x]) });
      }
    }
    pop = next;
  }

  // Extract Pareto front and three specific solutions
  fastNonDominatedSort(pop);
  const pareto = pop.filter(ind => ind.rank === 0);
  pareto.sort((a, b) => a.objectives[0] - b.objectives[0]);

  const toPS = (ind: Individual): ParetoSolution => ({
    days: ind.routes.length,
    totalDistance: Math.round(ind.objectives[0] * 100) / 100,
    maxDayHours: Math.round(ind.objectives[1] * 100) / 100,
    routes: ind.routes.map(r => [...r]),
    dayRoutes: routesToDayRoutes(ind.routes),
  });

  const front = pareto.map(toPS);

  const minDist = pareto.reduce((a, b) => a.objectives[0] < b.objectives[0] ? a : b);
  const minDur = pareto.reduce((a, b) => a.objectives[1] < b.objectives[1] ? a : b);

  // Balanced: closest to ideal point (min distance, min max-duration)
  const idealDist = minDist.objectives[0];
  const idealDur = minDur.objectives[1];
  const rangeDist = Math.max(...pareto.map(p => p.objectives[0])) - idealDist || 1;
  const rangeDur = Math.max(...pareto.map(p => p.objectives[1])) - idealDur || 1;
  const balanced = pareto.reduce((best, ind) => {
    const score = (ind.objectives[0] - idealDist) / rangeDist + (ind.objectives[1] - idealDur) / rangeDur;
    const bestScore = (best.objectives[0] - idealDist) / rangeDist + (best.objectives[1] - idealDur) / rangeDur;
    return score < bestScore ? ind : best;
  });

  return {
    balanced: toPS(balanced),
    minDistance: toPS(minDist),
    minDuration: toPS(minDur),
    paretoFront: front,
    totalEvaluations: evals,
  };
}

// ─── Convert routes to DayRoute ─────────────────────────────

function routesToDayRoutes(routes: number[][]): DayRoute[] {
  return routes.map((indices, di) => {
    const stops: Stop[] = [];
    let cd = 0, ct = 0;
    stops.push({ sequence: 0, name: "Casa", lat: _home.lat, lng: _home.lng, distanceFromPrev: 0, cumulativeDistance: 0, cumulativeTime: 0, isHome: true });
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      const d = pd(i === 0 ? -1 : indices[i - 1], idx);
      cd += d; ct += d / _cfg.avgSpeed + _cfg.visitTime / 60;
      stops.push({ sequence: i + 1, name: _locs[idx].name, lat: _locs[idx].lat, lng: _locs[idx].lng, distanceFromPrev: d, cumulativeDistance: cd, cumulativeTime: ct, isHome: false });
    }
    const ret = pd(indices[indices.length - 1], -1);
    cd += ret; ct += ret / _cfg.avgSpeed;
    stops.push({ sequence: indices.length + 1, name: "Casa", lat: _home.lat, lng: _home.lng, distanceFromPrev: ret, cumulativeDistance: cd, cumulativeTime: ct, isHome: true });
    return { day: di + 1, stops, totalDistance: cd, totalTime: ct, totalStops: indices.length };
  });
}
