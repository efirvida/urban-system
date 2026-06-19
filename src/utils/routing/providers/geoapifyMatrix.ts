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
 * See: https://apidocs.geoapify.com/docs/route-matrix/
 */

import type { BatchRouteProvider, Point } from "../types";

const GEOAPIFY_MATRIX_URL = "https://api.geoapify.com/v1/routematrix";
const MAX_BATCH_SIZE = 15;
const REQUEST_TIMEOUT_MS = 30000;

interface GeoapifyMatrixResponse {
  sources?: Array<{ location_index?: number }>;
  destinations?: Array<{ location_index?: number }>;
  distances?: (number | null)[][];
}

export class GeoapifyMatrixProvider implements BatchRouteProvider {
  readonly name = "geoapify-matrix";
  /** Below OSRM (1) and ORS (0.5) — highest tier in the consensus. */
  readonly priority = -1;

  async buildMatrix(points: Point[]): Promise<Map<string, number | null>> {
    const result = new Map<string, number | null>();
    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey) return result;
    if (points.length < 2) return result;

    // No chunking needed for a single batch.
    if (points.length <= MAX_BATCH_SIZE) {
      const chunk = await this.fetchChunk(points, apiKey);
      this.mergeChunk(result, chunk, 0, points.length);
      return result;
    }

    // Chunk by sliding window of MAX_BATCH_SIZE. We request the matrix
    // for indices [start, end) where end = min(start+MAX, n). The
    // resulting matrix is (end-start) x n; we keep the upper-triangular
    // off-window pairs (start..end) × [0..n).
    for (let start = 0; start < points.length - 1; start += MAX_BATCH_SIZE - 1) {
      const end = Math.min(start + MAX_BATCH_SIZE, points.length);
      const window = points.slice(start, end);
      const chunk = await this.fetchChunk(window, apiKey);
      this.mergeChunk(result, chunk, start, end);
      // Stop early when the window no longer reaches the next row.
      if (end === points.length) break;
    }

    return result;
  }

  /** Hit the Geoapify API for one chunk and return the raw matrix. */
  private async fetchChunk(
    points: Point[],
    apiKey: string,
  ): Promise<GeoapifyMatrixResponse | null> {
    try {
      const res = await fetch(GEOAPIFY_MATRIX_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "drive",
          sources: points.map((p) => [p.lng, p.lat]),
          destinations: points.map((p) => [p.lng, p.lat]),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as GeoapifyMatrixResponse;
      if (!data || !Array.isArray(data.distances)) return null;
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Merge one chunk's matrix into the result map. The chunk is a
   * `rows` (window length) × `points.length` matrix; we keep only the
   * upper-triangle pairs `(i, j)` with `i < j` and `i` inside the
   * window. Distances are in meters — converted to km.
   */
  private mergeChunk(
    target: Map<string, number | null>,
    chunk: GeoapifyMatrixResponse | null,
    windowStart: number,
    windowEnd: number,
  ): void {
    if (!chunk || !Array.isArray(chunk.distances)) return;
    const matrix = chunk.distances;
    for (let r = 0; r < matrix.length; r++) {
      const row = matrix[r];
      if (!Array.isArray(row)) continue;
      const i = windowStart + r;
      if (i >= windowEnd) break;
      for (let c = 0; c < row.length; c++) {
        const j = c;
        if (j <= i) continue;
        const raw = row[c];
        if (typeof raw !== "number" || !Number.isFinite(raw)) {
          target.set(`${i},${j}`, null);
        } else {
          target.set(`${i},${j}`, raw / 1000);
        }
      }
    }
  }
}
