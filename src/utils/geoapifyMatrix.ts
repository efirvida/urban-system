/**
 * Geoapify Route Matrix API wrapper.
 *
 * Calculates all-pairs driving distances using batched API requests.
 *
 * LIMIT: Geoapify allows max 1000 matrix elements per request (sources × targets).
 * For N points, we split into chunks of at most 31 points (31 × 31 = 961 ≤ 1000)
 * and make batchA×batchB requests covering all pairs.
 *
 * When Geoapify returns null for a pair (no road found), we fallback to Haversine.
 *
 * Pricing (free tier: 3000 credits/day):
 *   cost per request = max(s, t) × min(s, t, 10)
 *   For N=48: 3 batches → ~790 credits per full matrix
 *
 * Docs: https://apidocs.geoapify.com/docs/route-matrix/
 */

import { Location } from "@/types";

// ─── Types ───────────────────────────────────────────────────

interface GeoapifyMatrixCell {
  distance: number; // meters
  time: number;     // seconds
  source_index: number;
  target_index: number;
}

interface GeoapifyResponse {
  sources_to_targets: GeoapifyMatrixCell[][];
}

// ─── Constants ───────────────────────────────────────────────

const GEOAPIFY_BASE = "https://api.geoapify.com/v1/routematrix";
const REQUEST_TIMEOUT = 25000; // 25s per batch
const MAX_ELEMENTS = 1000; // Geoapify limit: sources × targets ≤ 1000
const MAX_CHUNK_SIZE = 15; // Smaller chunks → more reliable per-pair results

// ─── Internal helpers ────────────────────────────────────────

interface Waypoint {
  location: [number, number];
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

async function callGeoapifyBatch(
  sources: Waypoint[],
  targets: Waypoint[],
  sourceOffset: number,
  targetOffset: number,
  apiKey: string
): Promise<GeoapifyMatrixCell[]> {
  const url = `${GEOAPIFY_BASE}?apiKey=${apiKey}`;
  const payload = {
    mode: "drive",
    type: "short",
    sources,
    targets,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Geoapify HTTP ${response.status}: ${body.slice(0, 200)}`
    );
  }

  const data: GeoapifyResponse = await response.json();

  if (!data.sources_to_targets?.length) {
    return [];
  }

  // Flatten the 2D matrix and adjust indices to global positions
  const cells: GeoapifyMatrixCell[] = [];
  const dbg: string[] = [];
  for (let si = 0; si < data.sources_to_targets.length; si++) {
    const row = data.sources_to_targets[si];
    if (!row) continue;
    for (const cell of row) {
      const gi = cell.source_index + sourceOffset;
      const gj = cell.target_index + targetOffset;
      if (gi < gj && dbg.length < 6) {
        dbg.push(`global(${gi},${gj})=${(cell.distance / 1000).toFixed(1)}km`);
      }
      cells.push({
        distance: cell.distance,
        time: cell.time,
        source_index: gi,
        target_index: gj,
      });
    }
  }
  console.log(`[Geoapify] Raw batch (offset=${sourceOffset},${targetOffset}): ${dbg.join(', ')}`);
  return cells;
}

// ─── Main export ─────────────────────────────────────────────

/**
 * Build a distance matrix using Geoapify Route Matrix API.
 *
 * Splits points into chunks of ≤31 and makes batch requests
 * to stay within Geoapify's 1000-element per-request limit.
 *
 * @param locations  - POIs to visit (without home)
 * @param home       - Starting/depot location
 * @param apiKey     - Geoapify API key
 * @returns A distance matrix in the format { "i,j": km }
 *          where 0 = home, 1..n = locations
 */
export async function buildGeoapifyMatrix(
  locations: Location[],
  home: Location,
  apiKey: string
): Promise<Record<string, number>> {
  // Build the points array: home first, then all locations
  const all: Array<{ lat: number; lng: number }> = [
    { lat: home.lat, lng: home.lng },
    ...locations,
  ];
  const N = all.length;
  const totalPairs = (N * (N - 1)) / 2;

  console.log(`[Geoapify] Building matrix for ${N} points (${totalPairs} pairs), chunks of ${MAX_CHUNK_SIZE}`);

  // Convert all points to waypoints
  const waypoints: Waypoint[] = all.map((p) => ({
    location: [p.lng, p.lat] as [number, number],
  }));

  // Split into chunks
  const chunks = chunkArray(waypoints, MAX_CHUNK_SIZE);
  const numChunks = chunks.length;
  console.log(`[Geoapify] ${numChunks} chunks: ${chunks.map(c => c.length).join('+')}`);

  const matrix: Record<string, number> = {};
  const t0 = Date.now();
  let totalBatches = 0;
  let totalApiElements = 0;

  // For each pair of chunks (including self-pair: A×A)
  for (let ci = 0; ci < numChunks; ci++) {
    const sourceOffset = chunks.slice(0, ci).reduce((s, c) => s + c.length, 0);
    for (let cj = ci; cj < numChunks; cj++) {
      const targetOffset = chunks.slice(0, cj).reduce((s, c) => s + c.length, 0);
      const sources = chunks[ci];
      const targets = chunks[cj];

      const apiElements = sources.length * targets.length;
      if (apiElements > MAX_ELEMENTS) {
        console.warn(`[Geoapify] Skipping chunk pair (${ci},${cj}): ${apiElements} > ${MAX_ELEMENTS}`);
        continue;
      }

      totalBatches++;
      totalApiElements += apiElements;

      console.log(`[Geoapify] Batch ${totalBatches}: chunk(${ci}×${cj}) ${sources.length}src×${targets.length}tgt = ${apiElements} elements`);

      const cells = await callGeoapifyBatch(sources, targets, sourceOffset, targetOffset, apiKey);

      // Store only upper triangle (i < j)
      for (const cell of cells) {
        if (cell.source_index < cell.target_index) {
          const key = `${cell.source_index},${cell.target_index}`;
          if (cell.distance !== null && cell.distance !== undefined && cell.distance >= 0) {
            matrix[key] = Math.round((cell.distance / 1000) * 100) / 100;
          }
          // null distance → skip; downstream treats missing key as unreachable
        }
      }
    }
  }

  const elapsed = Date.now() - t0;
  const stored = Object.keys(matrix).length;

  console.log(`[Geoapify] Done: ${stored}/${totalPairs} pairs, ${totalBatches} batches, ${totalApiElements} API elements, ${elapsed}ms`);

  if (stored < totalPairs) {
    console.warn(`[Geoapify] Matrix incomplete: ${stored}/${totalPairs} pairs`);
  }

  return matrix;
}
