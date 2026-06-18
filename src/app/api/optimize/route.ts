import { NextRequest, NextResponse } from "next/server";
import {
  Location,
  Config,
  ParetoSolution,
  ApiError,
  UnreachablePoi,
  DistanceMatrix,
  MatrixEntry,
} from "@/types";
import { optimizeRoutes } from "@/utils/routerOptimizer";
import { runNSGA2 } from "@/utils/nsga2";
import { filterUnreachable } from "@/utils/unreachableFilter";

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
      useStrictMatrix: useStrictMatrixTopLevel,
    } = body as {
      locations: Location[];
      config: Config;
      algorithm?: string;
      distanceMatrix?: Record<string, number>;
      useStrictMatrix?: boolean;
    };

    const useStrictMatrix: boolean =
      typeof useStrictMatrixTopLevel === "boolean"
        ? useStrictMatrixTopLevel
        : Boolean(config?.useStrictMatrix);

    console.log("[API] Body:", { locations: locations?.length, algorithm, hasMatrix: !!frontendMatrix, useStrictMatrix });

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

    // ── Step 1: Use the frontend-provided matrix (complete, real-only or Infinity) ──
    const matrix: Record<string, number> = frontendMatrix ? { ...frontendMatrix } : {};

    if (Object.keys(matrix).length > 0) {
      console.log(`[API] Frontend matrix: ${Object.keys(matrix).length}/${totalPairs} pairs`);
    } else {
      console.log(`[API] No frontend matrix — starting empty`);
    }

    // ── Build DistanceMatrix when strict flag is on (inline, no helper) ──
    let strictMatrix: DistanceMatrix | undefined;
    if (useStrictMatrix) {
      strictMatrix = {};
      let realCount = 0, unreachCount = 0;
      for (const key of Object.keys(matrix)) {
        const d = matrix[key];
        const source: MatrixEntry["source"] =
          d === undefined || !Number.isFinite(d) ? "unreachable" : "real";
        strictMatrix[key] = { distance: d, source };
        if (source === "real") realCount++;
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
