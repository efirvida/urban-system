/**
 * OrsOptimizer — calls OpenRouteService's Optimization API to get a
 * real-road visit order, then re-projects that order into our
 * `DayRoute[]` shape using OUR distance matrix (so all algorithms
 * score from the same distances and results stay comparable).
 *
 * Flow:
 *   1. Bail to `null` if `ORS_API_KEY` is unset.
 *   2. Check the in-memory cache. Hit → log + return.
 *   3. POST to `/v2/optimization` with one vehicle, N jobs, single
 *      time window derived from the user's `constraintValue`.
 *   4. Parse the response: each route has an ordered `jobs` array
 *      (job IDs "loc_<i>" → original POI index).
 *   5. Re-split into days using the user's constraints + our matrix
 *      for both leg and return distances.
 *   6. Cache + return.
 *
 * Graceful failure: missing key or HTTP error → `null`.
 * Throws are caught → `null` (so the registry slot is empty).
 */

import type { DayRoute, Stop } from '@/types';
import { getCachedOptimizerResult, setCachedOptimizerResult, optimizerCacheKey } from '../cache';
import type { Optimizer, OptimizeParams, OptimizerResult } from '../types';

const ORS_OPT_BASE = 'https://api.openrouteservice.org/v2/optimization';
const REQUEST_TIMEOUT_MS = 30_000;

interface VisitOrderEntry {
  idx: number;
  loc: { lat: number; lng: number; name: string };
}

export class OrsOptimizer implements Optimizer {
  readonly name = 'ors';
  readonly label = 'ORS Route Planner';

  async optimize(params: OptimizeParams): Promise<OptimizerResult | null> {
    const apiKey = process.env.ORS_API_KEY;
    if (!apiKey) return null;
    if (params.locations.length === 0) return null;

    const cacheKey = optimizerCacheKey(params.locations, params.config);
    const cached = getCachedOptimizerResult(cacheKey);
    if (cached) {
      console.log(`[ORS] cache hit: ${cacheKey}`);
      return cached;
    }
    console.log(`[ORS] cache miss: ${cacheKey}`);

    try {
      const body = this.buildRequestBody(params);
      const res = await fetch(ORS_OPT_BASE, {
        method: 'POST',
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        // 404 = endpoint not available on public API (only self-hosted).
        // Log once, then bail silently so the registry slot is null.
        if (res.status === 404) {
          console.warn(
            '[ORS] Optimization endpoint not available on public API (needs self-hosted ORS).',
          );
        } else {
          console.warn(`[ORS] HTTP ${res.status} ${res.statusText}`);
        }
        return null;
      }

      const data = (await res.json()) as OrsOptimizationResponse;
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
      console.warn('[ORS] Optimization failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  private buildRequestBody(params: OptimizeParams) {
    const homeLngLat: [number, number] = [params.home.lng, params.home.lat];
    const maxTime =
      params.config.constraintType === 'hours' || params.config.constraintType === 'hours+visits'
        ? params.config.constraintValue * 3600
        : 28800;

    return {
      jobs: params.locations.map((loc, i) => ({
        id: `loc_${i}`,
        location: [loc.lng, loc.lat] as [number, number],
        duration: (params.config.visitTime || 30) * 60,
      })),
      vehicles: [
        {
          id: 'vehicle_1',
          start: homeLngLat,
          end: homeLngLat,
          time_window: [0, maxTime],
        },
      ],
    };
  }

  private parseResponse(
    data: OrsOptimizationResponse,
    params: OptimizeParams,
  ): VisitOrderEntry[] | null {
    if (!data.routes?.length) return null;

    // ORS returns one route per vehicle. We have one vehicle, so the
    // first route's `jobs` array is the visit order (job IDs "loc_<i>").
    const route = data.routes[0];
    const jobIds = route.jobs || [];
    if (!Array.isArray(jobIds) || jobIds.length === 0) return null;

    const visitOrder: VisitOrderEntry[] = [];
    for (const jobId of jobIds) {
      const idx = Number.parseInt(String(jobId).replace('loc_', ''), 10);
      if (Number.isNaN(idx)) continue;
      const loc = params.locations[idx];
      if (!loc) continue;
      visitOrder.push({ idx, loc });
    }
    return visitOrder;
  }

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
    const visitTimeH = (config.visitTime || 30) / 60;

    const days: DayRoute[] = [];
    let currentStops: Stop[] = [];
    let dayDist = 0;
    let dayStops = 0;
    let prevMatrixIdx = 0;

    for (let pos = 0; pos < ordered.length; pos++) {
      const { idx, loc } = ordered[pos]!;
      const matrixIdx = idx + 1;
      const legDist = this.matGet(matrix, prevMatrixIdx, matrixIdx);
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
      currentStops.push({
        sequence: dayStops,
        name: loc.name,
        lat: loc.lat,
        lng: loc.lng,
        distanceFromPrev: legDist,
        cumulativeDistance: dayDist,
        cumulativeTime: dayDist / avgSpeed + dayStops * visitTimeH,
        isHome: false,
      });
      prevMatrixIdx = matrixIdx;
    }

    if (currentStops.length > 0) {
      days.push(this.finalizeDay(currentStops, days.length, home, prevMatrixIdx, matrix, avgSpeed));
    }
    return days;
  }

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

  private matGet(matrix: Record<string, number>, i: number, j: number): number {
    if (i === j) return 0;
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    const v = matrix[key];
    return v !== undefined && Number.isFinite(v) ? v : Infinity;
  }
}

interface OrsOptimizationRoute {
  vehicle?: string;
  jobs?: (string | number)[];
  /** Travel distance in meters. */
  distance?: number;
  /** Travel time in seconds. */
  time?: number;
}

interface OrsOptimizationResponse {
  routes?: OrsOptimizationRoute[];
  unassigned?: string[];
  total_distance?: number;
  total_time?: number;
}
