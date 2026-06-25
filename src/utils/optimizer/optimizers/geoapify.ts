/**
 * GeoapifyOptimizer — calls Geoapify's Route Planner API to get a
 * real-road visit order, then re-projects that order into our
 * `DayRoute[]` shape using OUR distance matrix (so all algorithms
 * score from the same distances and results stay comparable).
 *
 * Flow:
 *   1. Bail to `null` if `GEOAPIFY_API_KEY` is unset.
 *   2. Check the in-memory cache. Hit → log + return.
 *   3. POST to `/v1/routeplanner` with one agent, N jobs, single
 *      `time_window` derived from the user's `constraintValue`.
 *   4. Parse the GeoJSON FeatureCollection. The first feature's
 *      `properties.actions` (filtered to non-start/non-end) yields the
 *      visit order via `job_id` ("loc_<i>" → original POI index).
 *   5. Re-split into days using the user's constraints + our matrix
 *      for both leg and return distances.
 *   6. Cache + return.
 *
 * Graceful failure: 402/429 → `null` + one warn line. Throws are
 * caught → `null` (so the registry slot is empty, not poisoned).
 */

import type { DayRoute, Stop } from '@/types';
import { getCachedOptimizerResult, setCachedOptimizerResult, optimizerCacheKey } from '../cache';
import type { Optimizer, OptimizeParams, OptimizerResult } from '../types';

const GEOAPIFY_BASE = 'https://api.geoapify.com/v1/routeplanner';
const REQUEST_TIMEOUT_MS = 30_000;

interface VisitOrderEntry {
  /** Original index into `params.locations`. */
  idx: number;
  loc: { lat: number; lng: number; name: string };
}

export class GeoapifyOptimizer implements Optimizer {
  readonly name = 'geoapify';
  readonly label = 'Geoapify Route Planner';

  async optimize(params: OptimizeParams): Promise<OptimizerResult | null> {
    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey) {
      // No key — silent no-op. The registry slot is null, the UI hides
      // the tab. Don't warn: this is the common dev case.
      return null;
    }

    if (params.locations.length === 0) return null;

    const cacheKey = optimizerCacheKey(params.locations, params.config);
    const cached = getCachedOptimizerResult(cacheKey);
    if (cached) {
      console.log(`[Geoapify] cache hit: ${cacheKey}`);
      return cached;
    }
    console.log(`[Geoapify] cache miss: ${cacheKey}`);

    try {
      const body = this.buildRequestBody(params);
      const res = await fetch(`${GEOAPIFY_BASE}?apiKey=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        // 402 = no credits, 429 = rate limited — silent fail so the
        // other optimizers keep working.
        if (res.status === 402 || res.status === 429) {
          console.warn(`[Geoapify] ${res.status} ${res.statusText}`);
          return null;
        }
        console.warn(`[Geoapify] HTTP ${res.status} ${res.statusText}`);
        return null;
      }

      const data = (await res.json()) as GeoapifyResponse;
      const ordered = this.parseResponse(data, params);
      if (!ordered || ordered.length === 0) return null;

      const days = this.splitIntoDays(ordered, params);
      const totalDistance = days.reduce((s, d) => s + d.totalDistance, 0);
      const totalTime = days.reduce((s, d) => s + d.totalTime, 0);

      const result: OptimizerResult = {
        algorithm: this.name,
        label: this.label,
        days,
        totalDistance: Math.round(totalDistance * 100) / 100,
        totalDays: days.length,
        totalTime: Math.round(totalTime * 100) / 100,
      };

      setCachedOptimizerResult(cacheKey, result);
      return result;
    } catch (err) {
      console.warn(`[Geoapify] Route Planner failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  // ─── Request body ──────────────────────────────────────────

  private buildRequestBody(params: OptimizeParams) {
    const homeLngLat: [number, number] = [params.home.lng, params.home.lat];
    const maxTime =
      params.config.constraintType === 'hours' || params.config.constraintType === 'hours+visits'
        ? params.config.constraintValue * 3600
        : 28800; // default 8h for visits-only

    return {
      mode: 'drive',
      agents: [
        {
          start_location: homeLngLat,
          end_location: homeLngLat,
          time_windows: [[0, maxTime]],
        },
      ],
      jobs: params.locations.map((loc, i) => ({
        location: [loc.lng, loc.lat] as [number, number],
        duration: (params.config.visitTime || 30) * 60,
        id: `loc_${i}`,
      })),
      type: 'short',
    };
  }

  // ─── Response parsing ──────────────────────────────────────

  private parseResponse(data: GeoapifyResponse, params: OptimizeParams): VisitOrderEntry[] | null {
    if (!data.features?.length) return null;
    const feature = data.features[0];
    const props = feature.properties || {};
    const actions = props.actions || [];
    if (!Array.isArray(actions)) return null;

    // Filter out start/end, keep the rest. `job_id` is "loc_<i>" where
    // `i` is the original POI index in our request body.
    const visitOrder: VisitOrderEntry[] = [];
    for (const a of actions) {
      if (a.type === 'start' || a.type === 'end') continue;
      const jobId = a.job_id || '';
      const idx = Number.parseInt(jobId.replace('loc_', ''), 10);
      if (Number.isNaN(idx)) continue;
      const loc = params.locations[idx];
      if (!loc) continue; // index out of range — skip defensively
      visitOrder.push({ idx, loc });
    }
    return visitOrder;
  }

  // ─── Day splitting (simplified) ─────────────────────────────

  /**
   * Split the Geoapify visit order into days using the same
   * constraints the user configured. Distances come from OUR matrix
   * (so totals match what CW/NSGA-II report). Each day becomes a
   * `DayRoute` shaped exactly like `routerOptimizer.ts` emits: home
   * start (sequence 0) → POIs → home return (last sequence).
   */
  private splitIntoDays(ordered: VisitOrderEntry[], params: OptimizeParams): DayRoute[] {
    const { home, config, matrix } = params;

    const maxHours =
      config.constraintType === 'hours' || config.constraintType === 'hours+visits'
        ? config.constraintValue
        : 99;
    const maxVisits =
      config.constraintType === 'visits' || config.constraintType === 'hours+visits'
        ? config.maxVisits || Infinity
        : Infinity;
    const avgSpeed = config.avgSpeed || 60;
    const visitTimeH = (config.visitTime || 30) / 60; // minutes → hours

    const days: DayRoute[] = [];
    let currentStops: Stop[] = [];
    let dayDist = 0;
    let dayStops = 0;
    let prevMatrixIdx = 0; // home

    for (let pos = 0; pos < ordered.length; pos++) {
      const { idx, loc } = ordered[pos]!;
      const matrixIdx = idx + 1; // home=0, POIs 1..n

      // Leg distance: from previous point (home on day 1) to this POI.
      const legDist = this.matGet(matrix, prevMatrixIdx, matrixIdx);

      // Estimate total day time IF we add this stop. Includes the
      // return-to-home leg so the check doesn't fire one stop too late.
      const returnFromCurrent = this.matGet(matrix, matrixIdx, 0);
      const estDist = dayDist + legDist + returnFromCurrent;
      const estTime = estDist / avgSpeed + (dayStops + 1) * visitTimeH;

      const wouldExceed = dayStops >= maxVisits || (dayStops > 0 && estTime > maxHours);
      if (wouldExceed && currentStops.length > 0) {
        days.push(
          this.finalizeDay(currentStops, days.length, home, prevMatrixIdx, matrix, avgSpeed),
        );
        currentStops = [];
        dayDist = 0;
        dayStops = 0;
        prevMatrixIdx = 0;
      }

      // First stop of a new day — emit the home start.
      if (dayStops === 0) {
        currentStops.push({
          sequence: 0,
          name: home.name,
          lat: home.lat,
          lng: home.lng,
          distanceFromPrev: 0,
          cumulativeDistance: 0,
          cumulativeTime: 0,
          isHome: true,
        });
      }

      dayDist += legDist;
      dayStops += 1;
      const cumulativeTime = dayDist / avgSpeed + dayStops * visitTimeH;

      currentStops.push({
        sequence: dayStops,
        name: loc.name,
        lat: loc.lat,
        lng: loc.lng,
        distanceFromPrev: legDist,
        cumulativeDistance: dayDist,
        cumulativeTime,
        isHome: false,
      });

      prevMatrixIdx = matrixIdx;
    }

    if (currentStops.length > 0) {
      days.push(this.finalizeDay(currentStops, days.length, home, prevMatrixIdx, matrix, avgSpeed));
    }

    return days;
  }

  /** Append the home-return stop and package the day totals. */
  private finalizeDay(
    stops: Stop[],
    dayNum: number,
    home: { lat: number; lng: number; name: string },
    prevMatrixIdx: number,
    matrix: Record<string, number>,
    avgSpeed: number,
  ): DayRoute {
    const returnDist = this.matGet(matrix, prevMatrixIdx, 0);
    const lastCum = stops.length > 0 ? stops[stops.length - 1]!.cumulativeDistance : 0;
    const lastTime = stops.length > 0 ? stops[stops.length - 1]!.cumulativeTime : 0;

    const totalDist = lastCum + returnDist;
    const totalTime = lastTime + returnDist / avgSpeed;

    stops.push({
      sequence: stops.length,
      name: home.name,
      lat: home.lat,
      lng: home.lng,
      distanceFromPrev: returnDist,
      cumulativeDistance: totalDist,
      cumulativeTime: totalTime,
      isHome: true,
    });

    return {
      day: dayNum + 1,
      stops,
      totalDistance: Math.round(totalDist * 100) / 100,
      totalTime: Math.round(totalTime * 100) / 100,
      totalStops: stops.filter((s) => !s.isHome).length,
    };
  }

  /** Symmetric matrix lookup; key is `min,max`. */
  private matGet(matrix: Record<string, number>, i: number, j: number): number {
    if (i === j) return 0;
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    const v = matrix[key];
    return v !== undefined && Number.isFinite(v) ? v : 0;
  }
}

// ─── Loose response shape ─────────────────────────────────────
// We only read a few fields, so a permissive type avoids fighting
// Geoapify's evolving schema.

interface GeoapifyAction {
  type: string;
  job_id?: string;
  location?: [number, number];
  start?: string;
  end?: string;
  duration?: number;
}

interface GeoapifyFeature {
  properties?: {
    actions?: GeoapifyAction[];
    waypoints?: unknown[];
    mode?: string;
  };
}

interface GeoapifyResponse {
  features?: GeoapifyFeature[];
  type?: string;
}
