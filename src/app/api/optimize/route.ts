import { NextRequest, NextResponse } from "next/server";
import {
  Location,
  Config,
  ParetoSolution,
  OptimizeResponse,
  ApiError,
  UnreachablePoi,
  DistanceMatrix,
  MatrixEntry,
  RoutingSource,
} from "@/types";
import { optimizeRoutes } from "@/utils/routerOptimizer";
import { runNSGA2 } from "@/utils/nsga2";
import { buildGeoapifyMatrix } from "@/utils/geoapifyMatrix";
import { haversineDistance } from "@/utils/haversine";
import { filterUnreachable } from "@/utils/unreachableFilter";
import { REAL_VS_ESTIMATED_KM, TINY_DISTANCE_KM } from "@/utils/constants";

function buildHaversineMatrix(locations: Location[], config: Config): Record<string, number> {
  const matrix: Record<string, number> = {};
  const all = [{ lat: config.homeLat, lng: config.homeLng }, ...locations];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      matrix[`${i},${j}`] = haversineDistance(all[i].lat, all[i].lng, all[j].lat, all[j].lng);
  return matrix;
}

/**
 * PR 6 (real-roads-only): build a `DistanceMatrix` (per-pair `MatrixEntry`)
 * alongside the legacy `Record<string, number>` matrix. Each entry is
 * tagged `real` when its distance differs from the Haversine reference
 * by more than `REAL_VS_ESTIMATED_KM` (or came from a provider cache hit
 * that the API knows about), `estimated` when it matches Haversine
 * (including sub-`TINY_DISTANCE_KM` pairs that were never sent to a
 * provider), and `unreachable` when the key is missing entirely.
 *
 * `geoapifyCache` flags the keys that came from a successful Geoapify
 * response — these get priority over the Haversine comparison when
 * tagging the source.
 */
function buildDistanceMatrix(
  matrix: Record<string, number>,
  haversineRef: Record<string, number>,
  geoapifyCache: Record<string, number>
): DistanceMatrix {
  const out: DistanceMatrix = {};
  for (const key of Object.keys(matrix)) {
    const d = matrix[key];
    let source: RoutingSource;
    if (d === undefined) {
      source = "unreachable";
    } else if (geoapifyCache[key] !== undefined) {
      // Provider returned a real road — trust it regardless of Haversine proximity
      source = "real";
    } else {
      const H = haversineRef[key];
      if (H !== undefined && H < TINY_DISTANCE_KM) {
        // Sub-50m pairs: Haversine is fine; the matrix entry IS the
        // Haversine value but we still tag it `real` (it represents a
        // sensible physical distance, not a routing-provider failure).
        // Per spec §`routing-source-tracking`: sub-50m pairs are
        // classified `estimated` (not an error). Match the spec.
        source = "estimated";
      } else if (H !== undefined && Math.abs(d - H) < REAL_VS_ESTIMATED_KM) {
        // Builder filled with a straight-line estimate because the
        // provider returned null.
        source = "estimated";
      } else {
        // Real OSRM/Geoapify road distance (or a successful cache hit).
        source = "real";
      }
    }
    out[key] = { distance: d, source };
  }
  return out;
}

export async function POST(request: NextRequest) {
  console.log("[API] /api/optimize called");
  const startTime = Date.now();
  try {
    const body = await request.json();
    const {
      locations,
      config,
      algorithm,
      distanceMatrix: frontendMatrix,
      geoapifyTried,
      useStrictMatrix: useStrictMatrixTopLevel,
    } = body as {
      locations: Location[];
      config: Config;
      algorithm?: string;
      distanceMatrix?: Record<string, number>;
      geoapifyTried?: string[];
      /**
       * PR 6 feature flag. Either a top-level body field or
       * `config.useStrictMatrix` activates the strict matrix path.
       * Top-level wins so the caller can override per-request.
       */
      useStrictMatrix?: boolean;
    };

    // Resolve the strict-matrix flag from both possible locations
    // (config field or top-level body field). Top-level wins.
    const useStrictMatrix: boolean =
      typeof useStrictMatrixTopLevel === "boolean"
        ? useStrictMatrixTopLevel
        : Boolean(config?.useStrictMatrix);

    const triedCount = geoapifyTried?.length ?? 0;
    console.log("[API] Body:", { locations: locations?.length, algorithm, hasMatrix: !!frontendMatrix, geoapifyTried: triedCount, useStrictMatrix });

    if (!locations?.length) {
      return NextResponse.json({ error: "Se requiere al menos una ubicación." } satisfies ApiError, { status: 400 });
    }
    if (typeof config.homeLat !== "number" || typeof config.homeLng !== "number") {
      return NextResponse.json({ error: "Coordenadas de casa inválidas." } satisfies ApiError, { status: 400 });
    }

    const normConfig: Config = {
      ...config,
      avgSpeed: config.avgSpeed || 60,
      visitTime: config.visitTime || 30,
    };

    const home = { name: "Casa", lat: normConfig.homeLat, lng: normConfig.homeLng };
    const totalPairs = (locations.length * (locations.length + 1)) / 2;
    const geoapifyKey = process.env.GEOAPIFY_API_KEY;

    // ── Step 1: Start with frontend matrix ──
    let matrix: Record<string, number>;
    let routingMode: "geoapify" | "osrm" | "haversine";

    if (frontendMatrix && Object.keys(frontendMatrix).length > 0) {
      matrix = { ...frontendMatrix };
      routingMode = "osrm";
      console.log(`[API] Frontend matrix: ${Object.keys(matrix).length}/${totalPairs} pairs`);
    } else {
      matrix = buildHaversineMatrix(locations, normConfig);
      routingMode = "haversine";
      console.log(`[API] No frontend matrix — Haversine fallback`);
    }

    // ── Step 2: Geoapify overrides (only for untried pairs) ──
    const triedSet = new Set(geoapifyTried || []);
    const allTried = triedSet.size >= totalPairs;
    const geoapifyCache: Record<string, number> = {};
    const geoapifyFailed: string[] = [];

    if (geoapifyKey && !allTried) {
      console.log(`[API] Geoapify: ${triedSet.size}/${totalPairs} already tried, computing missing...`);

      try {
        // Build full Geoapify matrix
        const geoMatrix = await buildGeoapifyMatrix(locations, home, geoapifyKey);

        // Override only for pairs where Geoapify returned a real road distance
        const haversineRef = buildHaversineMatrix(locations, normConfig);
        let overrides = 0;
        let skipped = 0;

        for (const key of Object.keys(geoMatrix)) {
          if (triedSet.has(key)) {
            skipped++;
            continue;
          }
          if (Math.abs(geoMatrix[key] - haversineRef[key]) > REAL_VS_ESTIMATED_KM) {
            matrix[key] = geoMatrix[key];
            geoapifyCache[key] = geoMatrix[key];
            overrides++;
          } else {
            geoapifyFailed.push(key);
          }
        }

        if (overrides > 0) routingMode = "geoapify";
        console.log(`[API] Geoapify: ${overrides} overrides, ${geoapifyFailed.length} failed, ${skipped} already tried`);
      } catch (err) {
        console.warn(`[API] Geoapify failed, using frontend matrix as fallback:`, err instanceof Error ? err.message : err);
        // Keep matrix as-is (frontend OSRM + Haversine)
        routingMode = routingMode === "haversine" ? "haversine" : "osrm";
      }
    } else if (geoapifyKey && allTried) {
      console.log(`[API] Geoapify skipped — all ${totalPairs} pairs already tried`);
    }

    // ── Log source breakdown vs Haversine ref ──
    {
      const havRef = buildHaversineMatrix(locations, normConfig);
      let geoCount = 0, osmCount = 0, havCount = 0;
      for (const key of Object.keys(matrix)) {
        if (geoapifyCache[key]) geoCount++;
        else if (Math.abs(matrix[key] - havRef[key]) > REAL_VS_ESTIMATED_KM) osmCount++;
        else havCount++;
      }
      console.log(`[API] Final matrix: ${Object.keys(matrix).length}/${totalPairs} pairs — Geoapify:${geoCount} OSRM:${osmCount} Haversine:${havCount}, source: ${routingMode}`);
    }
    if (Object.keys(matrix).length > 0) {
      const samples = Object.keys(matrix).sort((a, b) => {
        const [ia, ja] = a.split(',').map(Number);
        const [ib, jb] = b.split(',').map(Number);
        return ia - ib || ja - jb;
      }).slice(0, 5);
      console.log(`[API] Samples:`, samples.map(k => `${k}=${matrix[k].toFixed(2)}km`).join(', '));
    }

    // ── PR 6: build a `DistanceMatrix` (per-pair `MatrixEntry`) when
    //    the strict flag is on. The legacy `Record<string, number>`
    //    matrix is still built so the rest of the pipeline is identical
    //    when the flag is off (zero behavior change).
    const haversineRefForFilter = buildHaversineMatrix(locations, normConfig);
    let strictMatrix: DistanceMatrix | undefined;
    if (useStrictMatrix) {
      strictMatrix = buildDistanceMatrix(matrix, haversineRefForFilter, geoapifyCache);
      // Aggregate counts for the log
      let realCount = 0, estCount = 0, unreachCount = 0;
      for (const key of Object.keys(strictMatrix)) {
        const src = strictMatrix[key].source;
        if (src === "real") realCount++;
        else if (src === "estimated") estCount++;
        else unreachCount++;
      }
      console.log(`[API] Strict matrix: ${realCount} real, ${estCount} estimated, ${unreachCount} unreachable`);
    }

    // ── Step 2.5: Pre-filter unreachable POIs (PR 1: real-roads-only) ──
    // The matrix is keyed by index with home at 0 and POIs at 1..n.
    // A POI is unreachable when its home→P distance is missing from the
    // matrix or matches the Haversine reference within REAL_VS_ESTIMATED_KM
    // (i.e. the routing provider returned null and the matrix was filled
    // with a straight-line estimate). Sub-50m pairs are always reachable.
    //
    // PR 6: when the strict flag is on, call the strict overload that
    // reads `MatrixEntry.source` directly — no Haversine reference
    // needed.
    const { reachable, unreachable } = useStrictMatrix
      ? filterUnreachable(locations, home, strictMatrix as DistanceMatrix)
      : filterUnreachable(locations, home, matrix, haversineRefForFilter);
    if (unreachable.length > 0) {
      console.log(`[API] Pre-filter: ${unreachable.length}/${locations.length} POIs unreachable (no real road from home): ${unreachable.map(p => p.name).join(", ")}`);
    }
    const unreachableForResponse: UnreachablePoi[] = unreachable;

    // ── Step 3: Run BOTH algorithms and pick the best ──
    // Optimizer sees only `reachable` POIs. The matrix is keyed by index,
    // so we still pass the full matrix — keys for unreachable POIs will
    // simply never be looked up. (PR 2 will harden matGet to return
    // Infinity for any missing/unreachable key.)
    const tOpt = Date.now();
    const optimizedLocations = reachable;

    // Deterministic + GA. PR 6: when the strict flag is on, also pass
    // the `DistanceMatrix` so the optimizer consumes per-pair source
    // metadata end-to-end.
    const autoResult = await optimizeRoutes(
      optimizedLocations,
      normConfig,
      matrix,
      useStrictMatrix ? strictMatrix : undefined
    );
    const autoDistance = Math.round(autoResult.totalDistance * 100) / 100;
    const autoDays = autoResult.days.length;
    console.log(`[API] Auto: ${autoDays}d, ${autoDistance}km in ${Date.now() - tOpt}ms`);

    // NSGA2
    let nsgaData: Record<string, unknown> | null = null;
    try {
      const nsgaPromise = runNSGA2(
        optimizedLocations,
        home,
        normConfig,
        matrix,
        useStrictMatrix ? strictMatrix : undefined
      );
      const timeoutPromise = new Promise<null>(r => setTimeout(() => r(null), 30000));
      const nsgaResult = await Promise.race([nsgaPromise, timeoutPromise]);
      if (nsgaResult) {
        nsgaData = {
          balanced: nsgaResult.balanced,
          minDistance: nsgaResult.minDistance,
          paretoFront: nsgaResult.paretoFront,
          totalEvaluations: nsgaResult.totalEvaluations,
        };
        console.log(`[API] NSGA2: balanced=${nsgaResult.balanced.days}d/${nsgaResult.balanced.totalDistance}km minDist=${nsgaResult.minDistance.days}d/${nsgaResult.minDistance.totalDistance}km in ${Date.now() - tOpt}ms`);
      }
    } catch (err) {
      console.warn(`[API] NSGA2 failed, using auto only:`, err instanceof Error ? err.message : err);
    }

    // Pick the best: lower distance wins, fewer days breaks ties
    let bestDays = autoResult.days;
    let bestDistance = autoDistance;
    let bestDaysCount = autoDays;
    let winner = "Auto";

    if (nsgaData) {
      const n = nsgaData.minDistance as ParetoSolution;
      // Lower distance wins. If within 1%, fewer days wins.
      const nsgaBetter = n.totalDistance < bestDistance - 1;
      const nsgaSame = Math.abs(n.totalDistance - bestDistance) <= 1 && n.days < bestDaysCount;
      if (nsgaBetter || nsgaSame) {
        bestDays = n.dayRoutes;
        bestDistance = n.totalDistance;
        bestDaysCount = n.days;
        winner = "NSGA2";
      }
    }

    console.log(`[API] → ${winner} wins: ${bestDaysCount}d, ${bestDistance}km`);

    const basePayload: Record<string, unknown> = {
      days: bestDays,
      totalDistance: bestDistance,
      totalDays: bestDaysCount,
      totalLocations: locations.length,
      unreachable: unreachableForResponse,
      // PR 6: surface the strict matrix to the caller when the flag is
      // on. Legacy callers that ignore this field see no behavior change.
      ...(useStrictMatrix && strictMatrix ? { strictMatrix } : {}),
      _meta: {
        elapsedMs: Date.now() - startTime,
        osrmPairs: Object.keys(matrix).length,
        totalPairs,
        routingMode,
        unreachableCount: unreachableForResponse.length,
        // PR 6: echo the flag back so the frontend can correlate the
        // response shape with the requested mode.
        ...(useStrictMatrix ? { useStrictMatrix: true } : {}),
      },
      _matrixCache: Object.keys(geoapifyCache).length > 0 ? geoapifyCache : undefined,
      _geoapifyTried: geoapifyFailed.length > 0 ? geoapifyFailed : undefined,
    };

    // Include NSGA2 results for frontend to display options
    if (nsgaData) {
      basePayload._nsga2 = nsgaData;
      basePayload._autoDistance = autoDistance;
      basePayload._autoDays = autoDays;
    }

    return NextResponse.json(basePayload);

  } catch (error) {
    console.error("Optimization error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Error interno del servidor.", details: message } satisfies ApiError, { status: 500 });
  }
}
