import { NextRequest, NextResponse } from "next/server";
import {
  Location,
  Config,
  ParetoSolution,
  ApiError,
  UnreachablePoi,
  DistanceMatrix,
  RoutingSource,
} from "@/types";
import { optimizeRoutes } from "@/utils/routerOptimizer";
import { runNSGA2 } from "@/utils/nsga2";
import { buildGeoapifyMatrix } from "@/utils/geoapifyMatrix";
import { filterUnreachable } from "@/utils/unreachableFilter";

/**
 * Build a `DistanceMatrix` (per-pair `MatrixEntry`) from the legacy matrix.
 *
 * Source is determined by:
 * - Key missing or Infinity → "unreachable"
 * - Key in `geoapifyCache` → "real" (Geoapify returned a distance)
 * - Everything else → "real" (finite distance from OSRM/frontend)
 */
function buildDistanceMatrix(
  matrix: Record<string, number>,
  geoapifyCache: Record<string, number>
): DistanceMatrix {
  const out: DistanceMatrix = {};
  for (const key of Object.keys(matrix)) {
    const d = matrix[key];
    let source: RoutingSource;
    if (d === undefined || !Number.isFinite(d)) {
      source = "unreachable";
    } else if (geoapifyCache[key] !== undefined) {
      source = "real";
    } else {
      source = "real";
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
      useStrictMatrix?: boolean;
    };

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

    // ── Step 1: Start with frontend matrix (or empty) ──
    let matrix: Record<string, number> = frontendMatrix ? { ...frontendMatrix } : {};

    if (frontendMatrix && Object.keys(frontendMatrix).length > 0) {
      console.log(`[API] Frontend matrix: ${Object.keys(matrix).length}/${totalPairs} pairs`);
    } else {
      console.log(`[API] No frontend matrix — starting empty`);
    }

    // ── Step 2: Geoapify overrides (only for untried pairs) ──
    const triedSet = new Set(geoapifyTried || []);
    const allTried = triedSet.size >= totalPairs;
    const geoapifyCache: Record<string, number> = {};

    if (geoapifyKey && !allTried) {
      console.log(`[API] Geoapify: ${triedSet.size}/${totalPairs} already tried, computing missing...`);

      try {
        const geoMatrix = await buildGeoapifyMatrix(locations, home, geoapifyKey);

        let overrides = 0;
        let skipped = 0;

        for (const key of Object.keys(geoMatrix)) {
          if (triedSet.has(key)) {
            skipped++;
            continue;
          }
          // Geoapify returned a real road distance — use it
          matrix[key] = geoMatrix[key];
          geoapifyCache[key] = geoMatrix[key];
          overrides++;
        }

        console.log(`[API] Geoapify: ${overrides} overrides, ${skipped} already tried`);
      } catch (err) {
        console.warn(`[API] Geoapify failed, using frontend matrix as fallback:`, err instanceof Error ? err.message : err);
      }
    } else if (geoapifyKey && allTried) {
      console.log(`[API] Geoapify skipped — all ${totalPairs} pairs already tried`);
    }

    // ── Log final matrix stats ──
    {
      let geoCount = 0, finiteCount = 0, infCount = 0;
      for (const key of Object.keys(matrix)) {
        if (geoapifyCache[key]) geoCount++;
        else if (Number.isFinite(matrix[key])) finiteCount++;
        else infCount++;
      }
      console.log(`[API] Final matrix: ${Object.keys(matrix).length}/${totalPairs} pairs — Geoapify:${geoCount} OSRM:${finiteCount} Infinity:${infCount}`);
    }

    // ── Build DistanceMatrix when strict flag is on ──
    let strictMatrix: DistanceMatrix | undefined;
    if (useStrictMatrix) {
      strictMatrix = buildDistanceMatrix(matrix, geoapifyCache);
      let realCount = 0, unreachCount = 0;
      for (const key of Object.keys(strictMatrix)) {
        if (strictMatrix[key].source === "real") realCount++;
        else unreachCount++;
      }
      console.log(`[API] Strict matrix: ${realCount} real, ${unreachCount} unreachable`);
    }

    // ── Step 2.5: Pre-filter unreachable POIs ──
    const { reachable, unreachable } = useStrictMatrix && strictMatrix
      ? filterUnreachable(locations, home, strictMatrix)
      : filterUnreachable(locations, home, matrix);
    if (unreachable.length > 0) {
      console.log(`[API] Pre-filter: ${unreachable.length}/${locations.length} POIs unreachable: ${unreachable.map(p => p.name).join(", ")}`);
    }
    const unreachableForResponse: UnreachablePoi[] = unreachable;

    // ── Step 3: Run BOTH algorithms and pick the best ──
    const tOpt = Date.now();
    const optimizedLocations = reachable;

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

    // Pick the best
    let bestDays = autoResult.days;
    let bestDistance = autoDistance;
    let bestDaysCount = autoDays;
    let winner = "Auto";

    if (nsgaData) {
      const n = nsgaData.minDistance as ParetoSolution;
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
      ...(useStrictMatrix && strictMatrix ? { strictMatrix } : {}),
      _meta: {
        elapsedMs: Date.now() - startTime,
        osrmPairs: Object.keys(matrix).length,
        totalPairs,
        unreachableCount: unreachableForResponse.length,
        ...(useStrictMatrix ? { useStrictMatrix: true } : {}),
      },
    };

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
