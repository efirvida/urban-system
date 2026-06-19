import { NextRequest, NextResponse } from "next/server";
import {
  Location,
  Config,
  OptimizerResult,
  ApiError,
  UnreachablePoi,
  DistanceMatrix,
  MatrixEntry,
  ConsensusMatrix,
} from "@/types";
import { filterUnreachable } from "@/utils/unreachableFilter";
import { OptimizerRegistry } from "@/utils/optimizer/registry";
import { defaultOptimizers } from "@/utils/optimizer/optimizers";
import { RoutingService } from "@/utils/routing/service";
import { defaultProviders, batchProviders } from "@/utils/routing/providers";

export async function POST(request: NextRequest) {
  console.log("[API] /api/optimize called");
  const startTime = Date.now();
  try {
    const body = await request.json();
    const {
      locations,
      config,
      distanceMatrix: frontendMatrix,
      useStrictMatrix: useStrictMatrixTopLevel,
      useConsensus: useConsensusTopLevel,
    } = body as {
      locations: Location[];
      config: Config;
      algorithm?: string;
      distanceMatrix?: Record<string, number>;
      useStrictMatrix?: boolean;
      /**
       * consensus-matrix change: when true, the API builds a
       * `ConsensusMatrix` server-side via `RoutingService.buildConsensusMatrix`
       * and threads it into `OptimizeParams` so the optimizers can
       * apply the reliability pre-filter. Default `false` — legacy
       * path is bit-identical to the pre-change baseline.
       */
      useConsensus?: boolean;
    };

    const useStrictMatrix: boolean =
      typeof useStrictMatrixTopLevel === "boolean"
        ? useStrictMatrixTopLevel
        : Boolean(config?.useStrictMatrix);

    const useConsensus: boolean =
      typeof useConsensusTopLevel === "boolean" ? useConsensusTopLevel : false;

    console.log("[API] Body:", {
      locations: locations?.length,
      hasMatrix: !!frontendMatrix,
      useStrictMatrix,
      useConsensus,
    });

    if (!locations?.length) {
      return NextResponse.json(
        { error: "Se requiere al menos una ubicación." } satisfies ApiError,
        { status: 400 },
      );
    }
    if (typeof config.homeLat !== "number" || typeof config.homeLng !== "number") {
      return NextResponse.json(
        { error: "Coordenadas de casa inválidas." } satisfies ApiError,
        { status: 400 },
      );
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
      let realCount = 0,
        unreachCount = 0;
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
    const { reachable, unreachable } =
      useStrictMatrix && strictMatrix
        ? filterUnreachable(locations, home, strictMatrix)
        : filterUnreachable(locations, home, matrix);
    if (unreachable.length > 0) {
      console.log(
        `[API] Pre-filter: ${unreachable.length}/${locations.length} POIs unreachable: ${unreachable.map((p) => p.name).join(", ")}`,
      );
    }
    const unreachableForResponse: UnreachablePoi[] = unreachable;

    // ── Step 2.7: Build consensus matrix (opt-in) ──
    // Point set convention: 0 = home, 1..n = reachable POIs in array
    // order. The `buildConsensusMatrix` keys match `matGet` in
    // `routerOptimizer.ts` and the per-leg cache in `routing/cache.ts`.
    let consensusMatrix: ConsensusMatrix | undefined;
    let consensusElapsedMs = 0;
    if (useConsensus) {
      const tConsensus = Date.now();
      try {
        const consensusPoints: Array<{ lat: number; lng: number }> = [
          { lat: home.lat, lng: home.lng },
          ...reachable.map((p) => ({ lat: p.lat, lng: p.lng })),
        ];
        const routingService = new RoutingService(defaultProviders);
        consensusMatrix = await routingService.buildConsensusMatrix(
          consensusPoints,
          batchProviders,
        );
        consensusElapsedMs = Date.now() - tConsensus;
        const finite = Object.values(consensusMatrix).filter((e) =>
          Number.isFinite(e.distance),
        ).length;
        const unreach = Object.values(consensusMatrix).length - finite;
        console.log(
          `[API] Consensus: ${finite} finite, ${unreach} unreachable in ${consensusElapsedMs}ms`,
        );
      } catch (err) {
        console.warn("[API] Consensus build failed, continuing without it:", err);
        consensusMatrix = undefined;
        consensusElapsedMs = Date.now() - tConsensus;
      }
    }

    // ── Step 3: Run all registered optimizers in parallel ──
    const tOpt = Date.now();
    const optimizedLocations = reachable;

    const registry = new OptimizerRegistry(defaultOptimizers);
    const allResults = await registry.runAll({
      locations: optimizedLocations,
      home,
      config: normConfig,
      matrix,
      strictMatrix: useStrictMatrix ? strictMatrix : undefined,
      consensusMatrix,
    });

    // Best = lowest totalDistance, tiebreak by fewer days, then
    // registration order (array index).
    let best: OptimizerResult | null = null;
    let bestIdx = -1;
    for (let i = 0; i < allResults.length; i++) {
      const r = allResults[i];
      if (r === null) continue;
      if (
        best === null ||
        r.totalDistance < best.totalDistance - 1 ||
        (Math.abs(r.totalDistance - best.totalDistance) <= 1 &&
          r.totalDays < best.totalDays)
      ) {
        best = r;
        bestIdx = i;
      }
    }
    const winnerLabel = best ? best.label : "none";
    const successfulCount = allResults.filter((r) => r !== null).length;
    console.log(
      `[API] Optimizers: ${successfulCount}/${allResults.length} ok, winner=${winnerLabel} (${best?.totalDays ?? "?"}d, ${best?.totalDistance ?? "?"}km) in ${Date.now() - tOpt}ms`,
    );

    // ── Back-compat: if every optimizer failed, return 500 so the UI
    //    shows an error instead of empty data. ──
    if (best === null) {
      return NextResponse.json(
        {
          error:
            "Ningún optimizador pudo resolver el problema. Probá reducir el número de ubicaciones o revisar las conexiones de ruta.",
        } satisfies ApiError,
        { status: 500 },
      );
    }

    return NextResponse.json({
      days: best.days,
      totalDistance: best.totalDistance,
      totalDays: best.totalDays,
      totalLocations: locations.length,
      results: allResults,
      unreachable: unreachableForResponse,
      ...(useStrictMatrix && strictMatrix ? { strictMatrix } : {}),
      _meta: {
        elapsedMs: Date.now() - startTime,
        osrmPairs: Object.keys(matrix).length,
        totalPairs,
        unreachableCount: unreachableForResponse.length,
        ...(useStrictMatrix ? { useStrictMatrix: true } : {}),
        ...(useConsensus
          ? {
              useConsensus: true,
              consensusElapsedMs,
              consensusEntries: consensusMatrix
                ? Object.keys(consensusMatrix).length
                : 0,
            }
          : {}),
        winnerAlgorithm: best.algorithm,
        winnerLabel: best.label,
      },
    });
  } catch (error) {
    console.error("Optimization error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Error interno del servidor.", details: message } satisfies ApiError,
      { status: 500 },
    );
  }
}
