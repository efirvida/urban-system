/**
 * GeoapifyMatrixProvider — server-side batch matrix adapter.
 *
 * Posts the whole point set to Geoapify's `POST /v1/routematrix` endpoint
 * in a single request. Geoapify's free tier allows ~15 points per request
 * (limit imposed by their credit cap, not the API itself), so for larger
 * sets the provider transparently splits into overlapping chunks and
 * merges the upper triangle of each result.
 *
 * On any failure (missing key, HTTP error, malformed response) the
 * provider returns an empty map so the `ConsensusBuilder` can still
 * score the pair — the entry simply has no Geoapify vote.
 *
 * The `points` argument is the full set (including home at index 0
 * and POIs at 1..n). The resulting keys follow the legacy
 * `"i,j"` convention with `i < j`, matching the rest of the matrix
 * pipeline.
 *
 * In-memory cache: repeated calls with the same point set within
 * CACHE_TTL_MS skip the HTTP request entirely. This avoids credit
 * burn when the same locations are re-optimized (e.g. changing
 * constraint values without changing locations).
 *
 * See: https://apidocs.geoapify.com/docs/route-matrix/
 */

import type { BatchRouteProvider, Point } from "../types";

const GEOAPIFY_MATRIX_URL = "https://api.geoapify.com/v1/routematrix";
const MAX_BATCH_SIZE = 15;
const REQUEST_TIMEOUT_MS = 30000;
const CACHE_TTL_MS = 300_000; // 5 minutes

interface CacheEntry {
  result: Map<string, number | null>;
  timestamp: number;
}

const matrixCache = new Map<string, CacheEntry>();

interface GeoapifyCell {
  distance: number;
  time: number;
  source_index: number;
  target_index: number;
}

interface GeoapifyMatrixResponse {
  sources?: Array<{ location_index?: number }>;
  targets?: Array<{ location_index?: number }>;
  sources_to_targets?: GeoapifyCell[][];
}

export class GeoapifyMatrixProvider implements BatchRouteProvider {
  readonly name = "geoapify-matrix";
  /** Below OSRM (1) and ORS (0.5) — highest tier in the consensus. */
  readonly priority = -1;

  async buildMatrix(points: Point[]): Promise<Map<string, number | null>> {
    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey) return new Map();
    if (points.length < 2) return new Map();

    // In-memory cache hit → skip HTTP entirely.
    const cacheKey = this.cacheKey(points);
    const cached = matrixCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return new Map(cached.result);
    }

    const result = new Map<string, number | null>();

    // No chunking needed for a single batch.
    if (points.length <= MAX_BATCH_SIZE) {
      const chunk = await this.fetchChunk(points, points, apiKey);
      this.mergeChunk(result, chunk, 0, points.length);
      this.setCache(cacheKey, result);
      return result;
    }

    // Chunk by sliding window of MAX_BATCH_SIZE. Sources = window,
    // destinations = full point set, so response is (end-start) × n.
    // We keep the upper-triangular pairs (start..end) × [0..n).
    for (let start = 0; start < points.length - 1; start += MAX_BATCH_SIZE - 1) {
      const end = Math.min(start + MAX_BATCH_SIZE, points.length);
      const window = points.slice(start, end);
      const chunk = await this.fetchChunk(window, points, apiKey);
      this.mergeChunk(result, chunk, start, end);
      // Stop early when the window no longer reaches the next row.
      if (end === points.length) break;
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
    return `gm_${Math.abs(hash).toString(36)}`;
  }

  private setCache(key: string, result: Map<string, number | null>): void {
    // Evict oldest when over 20 entries.
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

  /**
   * Hit the Geoapify API for one chunk.
   *
   * `sources` = the window (rows we want),
   * `destinations` = the full point set (columns we want).
   * Response is `window.length × allPoints.length`.
   */
  private async fetchChunk(
    window: Point[],
    allPoints: Point[],
    apiKey: string,
  ): Promise<GeoapifyMatrixResponse | null> {
    try {
      const url = `${GEOAPIFY_MATRIX_URL}?apiKey=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "drive",
          sources: window.map((p) => [p.lng, p.lat]),
          targets: allPoints.map((p) => [p.lng, p.lat]),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as GeoapifyMatrixResponse;
      if (!data || !Array.isArray(data.sources_to_targets)) return null;
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Merge one chunk's matrix into the result map. The chunk has
   * `sources_to_targets` as `rows (window) × cols (allPoints)` where
   * each cell is `{ distance, time }`. We keep only the upper-triangle
   * pairs `(i, j)` with `i < j` and `i` inside the window.
   * Distances come in meters — converted to km.
   */
  private mergeChunk(
    target: Map<string, number | null>,
    chunk: GeoapifyMatrixResponse | null,
    windowStart: number,
    windowEnd: number,
  ): void {
    if (!chunk || !Array.isArray(chunk.sources_to_targets)) return;
    const matrix = chunk.sources_to_targets;
    for (let r = 0; r < matrix.length; r++) {
      const row = matrix[r];
      if (!Array.isArray(row)) continue;
      const i = windowStart + r;
      if (i >= windowEnd) break;
      for (let c = 0; c < row.length; c++) {
        const j = c;
        if (j <= i) continue;
        const cell = row[c];
        if (!cell || typeof cell.distance !== "number" || !Number.isFinite(cell.distance)) {
          target.set(`${i},${j}`, null);
        } else {
          target.set(`${i},${j}`, cell.distance / 1000);
        }
      }
    }
  }
}
