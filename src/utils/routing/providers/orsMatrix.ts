/**
 * OrsMatrixProvider — server-side batch matrix adapter for OpenRouteService.
 *
 * Posts the whole point set to ORS' `POST /v2/matrix/driving-car` endpoint.
 * ORS free tier limits requests to 5,000 elements per call (rows × cols),
 * which we treat as a hard cap and split larger sets into overlapping
 * chunks. ORS' response is the full NxN matrix in the order requested
 * (no source/destination remapping needed) — we keep the upper triangle
 * only, matching the legacy `"i,j"` convention.
 *
 * `ORS_API_KEY` is OPTIONAL — when missing the provider is a no-op
 * (returns an empty map) so the consensus degrades to the 2-provider
 * (Geoapify + OSRM) configuration. This matches the spec scenario
 * "ORS key missing falls back to two providers".
 *
 * See: https://openrouteservice.org/dev/#/api-docs/v2/matrix/{profile}/post
 */

import type { BatchRouteProvider, Point } from "../types";

const ORS_MATRIX_URL =
  "https://api.openrouteservice.org/v2/matrix/driving-car";
/** ORS free tier — keep well under the 5,000 element cap per request. */
const MAX_BATCH_SIZE = 15;
const REQUEST_TIMEOUT_MS = 30000;

interface OrsMatrixResponse {
  distances?: (number | null)[][];
  error?: string;
}

export class OrsMatrixProvider implements BatchRouteProvider {
  readonly name = "ors-matrix";
  /** Above Geoapify (-1), below OSRM (1) — middle tier. */
  readonly priority = 0.5;

  async buildMatrix(points: Point[]): Promise<Map<string, number | null>> {
    const result = new Map<string, number | null>();
    const apiKey = process.env.ORS_API_KEY;
    if (!apiKey) return result;
    if (points.length < 2) return result;

    if (points.length <= MAX_BATCH_SIZE) {
      const chunk = await this.fetchChunk(points, apiKey);
      this.mergeChunk(result, chunk);
      return result;
    }

    for (let start = 0; start < points.length - 1; start += MAX_BATCH_SIZE - 1) {
      const end = Math.min(start + MAX_BATCH_SIZE, points.length);
      const window = points.slice(start, end);
      const chunk = await this.fetchChunk(window, apiKey);
      this.mergeChunk(result, chunk, start, end);
      if (end === points.length) break;
    }

    return result;
  }

  private async fetchChunk(
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
      const data = (await res.json()) as OrsMatrixResponse;
      if (!data || !Array.isArray(data.distances)) return null;
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Merge one chunk's matrix into the result map. Distances come back
   * in meters — convert to km. The window starts at `windowStart`
   * in the global index space; pairs with both endpoints inside the
   * window are kept. Pairs that fall outside the window are dropped
   * (they'll be picked up by an overlapping chunk).
   */
  private mergeChunk(
    target: Map<string, number | null>,
    chunk: OrsMatrixResponse | null,
    windowStart = 0,
    windowEnd = Number.POSITIVE_INFINITY,
  ): void {
    if (!chunk || !Array.isArray(chunk.distances)) return;
    const matrix = chunk.distances;
    for (let r = 0; r < matrix.length; r++) {
      const row = matrix[r];
      if (!Array.isArray(row)) continue;
      const i = windowStart + r;
      if (i >= windowEnd) break;
      for (let c = 0; c < row.length; c++) {
        const j = windowStart + c;
        if (j <= i) continue;
        if (j >= windowEnd) continue;
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
