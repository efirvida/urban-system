/**
 * Genetic Algorithm for VRP — post-optimization refinement.
 *
 * Takes the Route-First solution and tries to improve it
 * through crossover and mutation of the giant tour.
 *
 * Chromosome: permutation of location indices (giant tour order).
 * Decoder: same as routerOptimizer — splits by constraint + NN reorder.
 */

import { Location, Config, DayRoute, Stop, DistanceMatrix } from "@/types";

// ─── Distance helpers ────────────────────────────────────────

/**
 * Pair-distance lookup. Always uses the strict `DistanceMatrix` —
 * the legacy flat-matrix code path is gone. Missing or
 * `unreachable` entries propagate `Infinity` so the optimizer
 * rejects the candidate (no Haversine fallback when we promised a
 * real-road matrix).
 */
function pd(
  a: number, b: number,
  locs: Location[],
  home: Location,
  pre: Record<string, number> | undefined,
  strict: DistanceMatrix
): number {
  void locs; void home; void pre;
  const ka = a === -1 ? 0 : a + 1;
  const kb = b === -1 ? 0 : b + 1;
  const k = ka < kb ? `${ka},${kb}` : `${kb},${ka}`;
  const entry = strict[k];
  if (entry === undefined) return Infinity;
  return entry.distance;
}

function routeDist(route: number[], locs: Location[], home: Location, pre: Record<string, number> | undefined, strict: DistanceMatrix): number {
  if (!route.length) return 0;
  let d = pd(-1, route[0], locs, home, pre, strict);
  for (let i = 1; i < route.length; i++) d += pd(route[i - 1], route[i], locs, home, pre, strict);
  d += pd(route[route.length - 1], -1, locs, home, pre, strict);
  return d;
}

function decode(perm: number[], locs: Location[], home: Location, cfg: Config, pre: Record<string, number> | undefined, strict: DistanceMatrix): number[][] {
  const routes: number[][] = [];
  let i = 0;
  while (i < perm.length) {
    const day: number[] = [];
    while (i < perm.length) {
      const prop = [...day, perm[i]];
      const km = routeDist(prop, locs, home, pre, strict);
      let v = false;
      switch (cfg.constraintType) {
        case "hours": { const h = km / cfg.avgSpeed + prop.length * cfg.visitTime / 60; if (h > cfg.constraintValue) v = true; break; }
        case "visits": if (prop.length > cfg.constraintValue) v = true; break;
        case "hours+visits": if (km / cfg.avgSpeed > cfg.constraintValue || prop.length > (cfg.maxVisits ?? 10)) v = true; break;
      }
      if (v) break;
      day.push(perm[i]); i++;
    }
    if (day.length === 0 && i < perm.length) { day.push(perm[i]); i++; }
    if (day.length > 0) {
      // NN reorder within day — restart from home when stuck
      const unvisited = new Set(day);
      const ordered: number[] = [];
      let cur = -1;
      let stuck = 0;
      while (unvisited.size > 0) {
        let n = -1, md = Infinity;
        for (const idx of unvisited) { const d = pd(cur, idx, locs, home, pre, strict); if (d < md) { md = d; n = idx; } }
        if (n === -1) {
          stuck++;
          if (stuck > day.length + 1) break; // safety
          cur = -1; // restart from home
          continue;
        }
        stuck = 0;
        ordered.push(n); cur = n; unvisited.delete(n);
      }
      routes.push(ordered);
    } else i++;
  }
  return routes;
}

function totalDist(routes: number[][], locs: Location[], home: Location, pre: Record<string, number> | undefined, strict: DistanceMatrix): number {
  return routes.reduce((s, r) => s + routeDist(r, locs, home, pre, strict), 0);
}

// ─── GA Operators ────────────────────────────────────────────

function randomPerm(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function orderCrossover(p1: number[], p2: number[]): [number[], number[]] {
  const n = p1.length;
  const c1 = Math.floor(Math.random() * (n - 1));
  const c2 = c1 + 1 + Math.floor(Math.random() * (n - c1 - 1));
  const ch1 = new Array(n).fill(-1), ch2 = new Array(n).fill(-1);
  const s1 = new Set(p1.slice(c1, c2 + 1)), s2 = new Set(p2.slice(c1, c2 + 1));
  for (let i = c1; i <= c2; i++) { ch1[i] = p1[i]; ch2[i] = p2[i]; }
  let idx = 0;
  for (let i = 0; i < n; i++) { if (ch1[i] !== -1) continue; while (s1.has(p2[idx])) idx++; ch1[i] = p2[idx++]; }
  idx = 0;
  for (let i = 0; i < n; i++) { if (ch2[i] !== -1) continue; while (s2.has(p1[idx])) idx++; ch2[i] = p1[idx++]; }
  return [ch1, ch2];
}

function mutate(p: number[]): number[] {
  const r = [...p];
  if (Math.random() < 0.5 && r.length >= 2) {
    const i = Math.floor(Math.random() * r.length);
    let j = Math.floor(Math.random() * r.length);
    while (j === i) j = Math.floor(Math.random() * r.length);
    [r[i], r[j]] = [r[j], r[i]];
  } else if (r.length >= 3) {
    const i = Math.floor(Math.random() * (r.length - 1));
    const j = i + 1 + Math.floor(Math.random() * (r.length - i - 1));
    let l = i, r2 = j; while (l < r2) { [r[l], r[r2]] = [r[r2], r[l]]; l++; r2--; }
  }
  return r;
}

// ─── Main ────────────────────────────────────────────────────

export interface GAResult {
  days: DayRoute[];
  totalDistance: number;
  totalDays: number;
  improvement: number; // km less than initial solution
}

/**
 * Run genetic algorithm to improve a VRP solution.
 * Starts from the given initial permutation (giant tour).
 *
 * PR 6: `strictMatrix` (optional `DistanceMatrix`) takes priority over
 * `precomputed` when supplied. Behavior is bit-identical when both are
 * absent (legacy Haversine path).
 */
export async function improveWithGA(
  initialPerm: number[],
  locations: Location[],
  home: Location,
  config: Config,
  precomputed: Record<string, number> | undefined,
  strictMatrix: DistanceMatrix
): Promise<GAResult> {
  const n = locations.length;
  if (n < 3) {
    const routes = decode(initialPerm, locations, home, config, precomputed, strictMatrix);
    const days = routesToDays(routes, locations, home, config, precomputed, strictMatrix);
    return { days, totalDistance: totalDist(routes, locations, home, precomputed, strictMatrix), totalDays: routes.length, improvement: 0 };
  }

  // Params
  const POP = 60;
  const GENS = 100;
  const CR = 0.85;
  const MR = 0.2;

  const FLOW = "[FLOW]";
  const tGa = Date.now();
  console.log(`${FLOW}     GA start: n=${n}, pop=${POP}, gens=${GENS}${strictMatrix ? " (strict matrix)" : ""}`);

  // Seed population: 20% from initial perm (mutated variants) + 80% random
  let pop: { perm: number[]; dist: number }[] = [];

  for (let i = 0; i < POP; i++) {
    let perm: number[];
    if (i < POP * 0.2) {
      // Mutated variant of initial solution
      perm = mutate(initialPerm);
      if (i > 0) perm = mutate(perm); // more mutation
    } else {
      perm = randomPerm(n);
    }
    const routes = decode(perm, locations, home, config, precomputed, strictMatrix);
    const dist = totalDist(routes, locations, home, precomputed, strictMatrix);
    pop.push({ perm, dist });
  }

  // Sort by distance
  pop.sort((a, b) => a.dist - b.dist);

  let bestDist = pop[0].dist;
  let bestPerm = [...pop[0].perm];

  for (let gen = 0; gen < GENS; gen++) {
    // Yield cada 10 generaciones para no bloquear el UI
    if (gen % 10 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }

    const offspring: typeof pop = [];

    while (offspring.length < POP) {
      // Tournament selection (size 3)
      const t1 = () => { const i = Math.floor(Math.random() * POP); const j = Math.floor(Math.random() * POP); return pop[i].dist < pop[j].dist ? pop[i] : pop[j]; };
      const p1 = t1();
      const p2 = t1();

      let c1: number[], c2: number[];
      if (Math.random() < CR) {
        [c1, c2] = orderCrossover(p1.perm, p2.perm);
      } else {
        c1 = [...p1.perm]; c2 = [...p2.perm];
      }

      if (Math.random() < MR) c1 = mutate(c1);
      if (Math.random() < MR) c2 = mutate(c2);

      const r1 = decode(c1, locations, home, config, precomputed, strictMatrix);
      const r2 = decode(c2, locations, home, config, precomputed, strictMatrix);
      offspring.push({ perm: c1, dist: totalDist(r1, locations, home, precomputed, strictMatrix) });
      if (offspring.length < POP) {
        offspring.push({ perm: c2, dist: totalDist(r2, locations, home, precomputed, strictMatrix) });
      }
    }

    // Combine + elitism (keep top 10%)
    const combined = [...pop, ...offspring];
    combined.sort((a, b) => a.dist - b.dist);
    pop = combined.slice(0, POP);

    if (pop[0].dist < bestDist) {
      bestDist = pop[0].dist;
      bestPerm = [...pop[0].perm];
    }
  }

  const finalRoutes = decode(bestPerm, locations, home, config, precomputed, strictMatrix);
  const initialDist = totalDist(decode(initialPerm, locations, home, config, precomputed, strictMatrix), locations, home, precomputed, strictMatrix);
  const days = routesToDays(finalRoutes, locations, home, config, precomputed, strictMatrix);
  const improvement = Math.round((initialDist - bestDist) * 100) / 100;

  console.log(`${FLOW}     GA done: ${Date.now() - tGa}ms, initial=${initialDist.toFixed(1)}km, best=${bestDist.toFixed(1)}km, improvement=${improvement}km, days=${finalRoutes.length}`);

  return {
    days,
    totalDistance: bestDist,
    totalDays: finalRoutes.length,
    improvement,
  };
}

// ─── Convert routes → DayRoute[] ─────────────────────────────

function routesToDays(
  routes: number[][],
  locs: Location[],
  home: Location,
  cfg: Config,
  pre: Record<string, number> | undefined,
  strict: DistanceMatrix
): DayRoute[] {
  return routes.map((indices, di) => {
    const stops: Stop[] = [];
    let cumD = 0, cumT = 0;
    stops.push({ sequence: 0, name: home.name, lat: home.lat, lng: home.lng, distanceFromPrev: 0, cumulativeDistance: 0, cumulativeTime: 0, isHome: true });
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      const d = pd(i === 0 ? -1 : indices[i - 1], idx, locs, home, pre, strict);
      cumD += d; cumT += d / cfg.avgSpeed + cfg.visitTime / 60;
      stops.push({ sequence: i + 1, name: locs[idx].name, lat: locs[idx].lat, lng: locs[idx].lng, distanceFromPrev: d, cumulativeDistance: cumD, cumulativeTime: cumT, isHome: false });
    }
    const ret = pd(indices[indices.length - 1], -1, locs, home, pre, strict);
    cumD += ret; cumT += ret / cfg.avgSpeed;
    stops.push({ sequence: indices.length + 1, name: home.name, lat: home.lat, lng: home.lng, distanceFromPrev: ret, cumulativeDistance: cumD, cumulativeTime: cumT, isHome: true });
    return { day: di + 1, stops, totalDistance: cumD, totalTime: cumT, totalStops: indices.length };
  });
}
