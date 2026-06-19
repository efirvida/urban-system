/**
 * OrsMatrixProvider — server-side batch matrix adapter for OpenRouteService.
 *
 * Posts the whole point set to ORS' `POST /v2/matrix/driving-car` endpoint.
 * Unlike Geoapify, ORS does not charge per query element, so we send ALL
 * points in a single request. ORS free tier supports up to 5,000 elements
 * (rows × columns), which is ≈ 70 × 70 — sufficient for realistic VRP
 * workloads. For sets beyond that, the provider falls back gracefully by
 * returning an empty map (no ORS vote for those pairs).
 *
 * `ORS_API_KEY` is OPTIONAL — when missing the provider is a no-op
 * (returns an empty map) so the consensus degrades to the 2-provider
 * (Geoapify + OSRM) configuration.
 *
 * See: https://openrouteservice.org/dev/#/api-docs/v2/matrix/{profile}/post
 */

import type { BatchRouteProvider, Point } from "../types";

const ORS_MATRIX_URL =
  "https://api.openrouteservice.org/v2/matrix/driving-car";
/** ORS free tier: 5,000 elements max → sqrt ≈ 70 points in a full N×N call. */
const MAX_POINTS_PER_CALL = 70;
const REQUEST_TIMEOUT_MS = 30000;
const CACHE_TTL_MS = 300_000; // 5 minutes

interface CacheEntry {
  result: Map<string, number | null>;
  timestamp: number;
}

const matrixCache = new Map<string, CacheEntry>();

interface OrsMatrixResponse {
  distances?: (number | null)[][];
  error?: string;
}

export class OrsMatrixProvider implements BatchRouteProvider {
  readonly name = "ors-matrix";
  /** Above Geoapify (-1), below OSRM (1) — middle tier. */
  readonly priority = 0.5;

  async buildMatrix(points: Point[]): Promise<Map<string, number | null>> {
    const apiKey = process.env.ORS_API_KEY;
    if (!apiKey) return new Map();
    if (points.length < 2) return new Map();

    // ORS returns the full N×N upper triangle in one call — no chunking
    // needed for realistic VRP sets. Beyond 70 points the request would
    // exceed the free-tier element cap; return empty and let OSRM cover
    // those pairs.
    if (points.length > MAX_POINTS_PER_CALL) return new Map();

    // In-memory cache hit → skip HTTP entirely.
    const cacheKey = this.cacheKey(points);
    const cached = matrixCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return new Map(cached.result);
    }

    const result = new Map<string, number | null>();
    const data = await this.fetchMatrix(points, apiKey);
    if (data && Array.isArray(data.distances)) {
      const matrix = data.distances;
      for (let i = 0; i < matrix.length; i++) {
        const row = matrix[i];
        if (!Array.isArray(row)) continue;
        for (let j = i + 1; j < row.length; j++) {
          const raw = row[j];
          const key = `${i},${j}`;
          if (typeof raw !== "number" || !Number.isFinite(raw)) {
            result.set(key, null);
          } else {
            result.set(key, raw / 1000);
          }
        }
      }
    }

    this.setCache(cacheKey, result);
    return result;
  }

  /** Deterministic cache key: sorted coordinate pairs hashed via djb2. */
  private cacheKey(points: Point[]): string {
    const str = points
      .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
      .sort()
      .join("|");
    let hash = 5381;
    for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    return `ors_${Math.abs(hash).toString(36)}`;
  }

  private setCache(key: string, result: Map<string, number | null>): void {
    if (matrixCache.size >= 20) {
      let oldest = Number.POSITIVE_INFINITY;
      let oldestKey = "";
      for (const [k, v] of matrixCache) {
        if (v.timestamp < oldest) { oldest = v.timestamp; oldestKey = k; }
      }
      if (oldestKey) matrixCache.delete(oldestKey);
    }
    matrixCache.set(key, { result: new Map(result), timestamp: Date.now() });
  }

  private async fetchMatrix(
    points: Point[],
    apiKey: string,
  ): Promise<OrsMatrixResponse | null> {
    try {
      const res = await fetch(ORS_MATRIX_URL, {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locations: points.map((p) => [p.lng, p.lat]),
          metrics: ["distance"],
          resolve_locations: false,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      return (await res.json()) as OrsMatrixResponse;
    } catch {
      return null;
    }
  }
}
