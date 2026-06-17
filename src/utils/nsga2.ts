/**
 * NSGA-II for Multi-Objective VRP.
 * All state is encapsulated in runNSGA2 — no module-level globals.
 *
 * Objectives:
 *   1. Minimize TOTAL DISTANCE (km)
 *   2. Minimize MAX DAY DURATION (hours)
 */

import { Location, Config, DayRoute, Stop } from "@/types";
import { haversineDistance } from "./haversine";

// ─── Types ───────────────────────────────────────────────────

interface Individual {
  perm: number[];
  loadFactor: number;
  routes: number[][];
  objectives: [number, number];
  rank: number;
  crowdingDist: number;
}

// ─── Exported types ──────────────────────────────────────────

export interface ParetoSolution {
  days: number;
  totalDistance: number;
  maxDayHours: number;
  routes: number[][];
  dayRoutes: DayRoute[];
}

export interface NSGAResult {
  balanced: ParetoSolution;
  minDistance: ParetoSolution;
  minDuration: ParetoSolution;
  paretoFront: ParetoSolution[];
  totalEvaluations: number;
}

// ─── Main export — creates fresh scope per call ─────────────

export function runNSGA2(
  locations: Location[],
  home: Location,
  config: Config,
  precomputed?: Record<string, number>
): NSGAResult {
  // ── Functions capture these by closure, no module state ──
  const n = locations.length;
  if (n < 3) {
    const empty: ParetoSolution = { days: 0, totalDistance: 0, maxDayHours: 0, routes: [], dayRoutes: [] };
    return { balanced: empty, minDistance: empty, minDuration: empty, paretoFront: [], totalEvaluations: 0 };
  }

  const POP = 120;
  const GENS = 200;
  const CR = 0.85;
  const MR = 0.2;

  // ── Distance helpers ──
  function pd(a: number, b: number): number {
    const ka = a === -1 ? 0 : a + 1;
    const kb = b === -1 ? 0 : b + 1;
    const k = ka < kb ? `${ka},${kb}` : `${kb},${ka}`;
    if (precomputed?.[k] !== undefined) return precomputed[k];
    const lat1 = a === -1 ? home.lat : (locations[a]?.lat ?? home.lat);
    const lng1 = a === -1 ? home.lng : (locations[a]?.lng ?? home.lng);
    const lat2 = b === -1 ? home.lat : (locations[b]?.lat ?? home.lat);
    const lng2 = b === -1 ? home.lng : (locations[b]?.lng ?? home.lng);
    return haversineDistance(lat1, lng1, lat2, lng2);
  }

  function routeDist(route: number[]): number {
    if (!route.length) return 0;
    let d = pd(-1, route[0]);
    for (let i = 1; i < route.length; i++) d += pd(route[i - 1], route[i]);
    d += pd(route[route.length - 1], -1);
    return d;
  }

  function routeHours(route: number[]): number {
    return routeDist(route) / config.avgSpeed + route.length * config.visitTime / 60;
  }

  function decode(perm: number[], lf: number): number[][] {
    const routes: number[][] = [];
    let i = 0;
    const maxH = config.constraintValue * lf;
    while (i < perm.length) {
      const day: number[] = [];
      while (i < perm.length) {
        const prop = [...day, perm[i]];
        if (routeHours(prop) > maxH) break;
        day.push(perm[i]); i++;
      }
      if (day.length === 0 && i < perm.length) { day.push(perm[i]); i++; }
      if (day.length > 0) {
        const uv = new Set(day);
        const ord: number[] = [];
        let cur = -1;
        while (uv.size > 0) {
          let nn = -1, md = Infinity;
          for (const idx of uv) { const d = pd(cur, idx); if (d < md) { md = d; nn = idx; } }
          if (nn === -1) break;
          ord.push(nn); cur = nn; uv.delete(nn);
        }
        routes.push(ord);
      } else i++;
    }
    return routes;
  }

  function computeObjectives(routes: number[][]): [number, number] {
    return [routes.reduce((s, r) => s + routeDist(r), 0), Math.max(...routes.map(r => routeHours(r)), 0)];
  }

  function randomPerm(): number[] {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function nnPermutation(): number[] {
    const v = new Set<number>(), p: number[] = [];
    let cur = -1;
    while (v.size < n) {
      let nn = -1, md = Infinity;
      for (let i = 0; i < n; i++) { if (v.has(i)) continue; const d = pd(cur, i); if (d < md) { md = d; nn = i; } }
      if (nn === -1) break;
      p.push(nn); v.add(nn); cur = nn;
    }
    return p;
  }

  // ── Initialization ──
  function initPopulation(): Individual[] {
    const pop: Individual[] = [];
    const nnCount = Math.max(2, Math.floor(POP * 0.1));
    for (let i = 0; i < POP; i++) {
      const perm = i < nnCount ? nnPermutation() : randomPerm();
      const lf = 0.5 + (i / POP) * 0.5;
      const routes = decode(perm, lf);
      pop.push({ perm, loadFactor: lf, routes, objectives: computeObjectives(routes), rank: 0, crowdingDist: 0 });
    }
    return pop;
  }

  // ── NSGA-II Core ──
  function dominates(a: [number, number], b: [number, number]): boolean {
    return (a[0] <= b[0] && a[1] <= b[1] && (a[0] < b[0] || a[1] < b[1]));
  }

  function fastNonDominatedSort(pop: Individual[]): void {
    const m = pop.length;
    const count = new Array(m).fill(0);
    const dom: number[][] = Array.from({ length: m }, () => []);
    for (let p = 0; p < m; p++) {
      for (let q = 0; q < m; q++) {
        if (p === q) continue;
        if (dominates(pop[p].objectives, pop[q].objectives)) dom[p].push(q);
        else if (dominates(pop[q].objectives, pop[p].objectives)) count[p]++;
      }
    }
    const fronts: number[][] = [];
    for (let p = 0; p < m; p++) { if (count[p] === 0) { pop[p].rank = 0; if (!fronts[0]) fronts[0] = []; fronts[0].push(p); } }
    let fi = 0;
    while (fronts[fi]) {
      const next: number[] = [];
      for (const p of fronts[fi]) { for (const q of dom[p]) { count[q]--; if (count[q] === 0) { pop[q].rank = fi + 1; next.push(q); } } }
      if (next.length > 0) fronts[fi + 1] = next;
      fi++;
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
      for (let i = 1; i < m - 1; i++) pop[front[i]].crowdingDist += (pop[front[i + 1]].objectives[objIdx] - pop[front[i - 1]].objectives[objIdx]) / range;
    }
  }

  function tournamentSelect(pop: Individual[]): Individual {
    const i = Math.floor(Math.random() * pop.length);
    const j = Math.floor(Math.random() * pop.length);
    const a = pop[i], b = pop[j];
    const better = (a.rank < b.rank || (a.rank === b.rank && a.crowdingDist > b.crowdingDist)) ? a : b;
    return { ...better, perm: [...better.perm], routes: better.routes.map(r => [...r]) };
  }

  function orderCrossover(p1: number[], p2: number[]): [number[], number[]] {
    const len = p1.length;
    const c1 = Math.floor(Math.random() * (len - 1));
    const c2 = c1 + 1 + Math.floor(Math.random() * (len - c1 - 1));
    const ch1 = new Array(len).fill(-1), ch2 = new Array(len).fill(-1);
    const s1 = new Set(p1.slice(c1, c2 + 1));
    for (let i = c1; i <= c2; i++) ch1[i] = p1[i];
    let idx = 0;
    for (let i = 0; i < len; i++) { if (ch1[i] !== -1) continue; while (s1.has(p2[idx])) idx++; ch1[i] = p2[idx++]; }
    return [ch1, ch2];
  }

  function mutate(perm: number[]): number[] {
    const r = [...perm];
    const i = Math.floor(Math.random() * r.length);
    let j = Math.floor(Math.random() * r.length);
    while (j === i) j = Math.floor(Math.random() * r.length);
    [r[i], r[j]] = [r[j], r[i]];
    return r;
  }

  function routesToDayRoutes(routes: number[][]): DayRoute[] {
    return routes.map((indices, di) => {
      const stops: Stop[] = [];
      let cd = 0, ct = 0;
      stops.push({ sequence: 0, name: "Casa", lat: home.lat, lng: home.lng, distanceFromPrev: 0, cumulativeDistance: 0, cumulativeTime: 0, isHome: true });
      for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        const d = pd(i === 0 ? -1 : indices[i - 1], idx);
        cd += d; ct += d / config.avgSpeed + config.visitTime / 60;
        stops.push({ sequence: i + 1, name: locations[idx].name, lat: locations[idx].lat, lng: locations[idx].lng, distanceFromPrev: d, cumulativeDistance: cd, cumulativeTime: ct, isHome: false });
      }
      const ret = pd(indices[indices.length - 1], -1);
      cd += ret; ct += ret / config.avgSpeed;
      stops.push({ sequence: indices.length + 1, name: "Casa", lat: home.lat, lng: home.lng, distanceFromPrev: ret, cumulativeDistance: cd, cumulativeTime: ct, isHome: true });
      return { day: di + 1, stops, totalDistance: cd, totalTime: ct, totalStops: indices.length };
    });
  }

  // ── Main loop ──
  let pop = initPopulation();
  let evals = POP;

  for (let gen = 0; gen < GENS; gen++) {
    const offspring: Individual[] = [];

    while (offspring.length < POP) {
      const p1 = tournamentSelect(pop);
      const p2 = tournamentSelect(pop);
      let c1: number[], c2: number[];
      let lf1 = p1.loadFactor, lf2 = p2.loadFactor;

      if (Math.random() < CR) {
        [c1, c2] = orderCrossover(p1.perm, p2.perm);
        const a = Math.random();
        lf1 = a * p1.loadFactor + (1 - a) * p2.loadFactor;
        lf2 = (1 - a) * p1.loadFactor + a * p2.loadFactor;
      } else {
        c1 = [...p1.perm]; c2 = [...p2.perm];
      }

      if (Math.random() < MR) c1 = mutate(c1);
      if (Math.random() < MR) c2 = mutate(c2);
      if (Math.random() < MR) lf1 = Math.max(0.4, Math.min(1.0, lf1 + (Math.random() - 0.5) * 0.2));
      if (Math.random() < MR) lf2 = Math.max(0.4, Math.min(1.0, lf2 + (Math.random() - 0.5) * 0.2));

      const r1 = decode(c1, lf1);
      const r2 = decode(c2, lf2);
      offspring.push({ perm: c1, loadFactor: lf1, routes: r1, objectives: computeObjectives(r1), rank: 0, crowdingDist: 0 });
      if (offspring.length < POP) { offspring.push({ perm: c2, loadFactor: lf2, routes: r2, objectives: computeObjectives(r2), rank: 0, crowdingDist: 0 }); }
    }

    evals += offspring.length;
    const combined = [...pop, ...offspring];
    fastNonDominatedSort(combined);

    const maxRank = Math.max(...combined.map(ind => ind.rank));
    const fronts: number[][] = Array.from({ length: maxRank + 1 }, () => []);
    for (let i = 0; i < combined.length; i++) fronts[combined[i].rank].push(i);
    for (const f of fronts) { if (f.length > 0) crowdingDistance(combined, f); }

    const next: Individual[] = [];
    let r = 0;
    while (r < fronts.length && next.length + fronts[r].length <= POP) {
      for (const idx of fronts[r]) next.push({ ...combined[idx], perm: [...combined[idx].perm], routes: combined[idx].routes.map(x => [...x]) });
      r++;
    }
    if (next.length < POP && r < fronts.length) {
      const remaining = fronts[r].map(idx => ({ idx, dist: combined[idx].crowdingDist })).sort((a, b) => b.dist - a.dist);
      for (let i = 0; i < remaining.length && next.length < POP; i++) {
        const idx = remaining[i].idx;
        next.push({ ...combined[idx], perm: [...combined[idx].perm], routes: combined[idx].routes.map(x => [...x]) });
      }
    }
    pop = next;
  }

  // ── Extract Pareto front ──
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

  const idealDist = minDist.objectives[0];
  const idealDur = minDur.objectives[1];
  const rDist = Math.max(...pareto.map(p => p.objectives[0])) - idealDist || 1;
  const rDur = Math.max(...pareto.map(p => p.objectives[1])) - idealDur || 1;
  const balanced = pareto.reduce((best, ind) => {
    const score = (ind.objectives[0] - idealDist) / rDist + (ind.objectives[1] - idealDur) / rDur;
    return score < ((best.objectives[0] - idealDist) / rDist + (best.objectives[1] - idealDur) / rDur) ? ind : best;
  });

  return {
    balanced: toPS(balanced),
    minDistance: toPS(minDist),
    minDuration: toPS(minDur),
    paretoFront: front,
    totalEvaluations: evals,
  };
}
