import { NextRequest } from "next/server";
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
import { RELIABILITY_FLOOR } from "@/utils/constants";
import { filterUnreachable } from "@/utils/unreachableFilter";
import { OptimizerRegistry } from "@/utils/optimizer/registry";
import { defaultOptimizers } from "@/utils/optimizer/optimizers";
import { RoutingService } from "@/utils/routing/service";
import { defaultProviders, batchProviders } from "@/utils/routing/providers";
import type { OnConsensusProgress } from "@/utils/routing/consensusBuilder";

// ─── Core optimization logic ──────────────────────────────────

/**
 * Run the full optimization pipeline (pre-filter → consensus → optimizers).
 * When `onProgress` is provided, it fires progress events during the
 * consensus matrix build so callers can stream them to the client.
 */
async function optimize(
  request: NextRequest,
  onProgress?: OnConsensusProgress,
): Promise<Record<string, unknown>> {
  const startTime = Date.now();
  const body = await request.clone().json();
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
    useConsensus?: boolean;
  };

  const useStrictMatrix: boolean =
    typeof useStrictMatrixTopLevel === "boolean"
      ? useStrictMatrixTopLevel
      : Boolean(config?.useStrictMatrix);

  const useConsensus: boolean =
    typeof useConsensusTopLevel === "boolean" ? useConsensusTopLevel : false;

  if (!locations?.length) {
    return { error: "Se requiere al menos una ubicación." };
  }
  if (typeof config.homeLat !== "number" || typeof config.homeLng !== "number") {
    return { error: "Coordenadas de casa inválidas." };
  }

  const normConfig: Config = {
    ...config,
    avgSpeed: config.avgSpeed || 60,
    visitTime: config.visitTime || 30,
  };

  const home = { name: "Casa", lat: normConfig.homeLat, lng: normConfig.homeLng };
  const totalPairs = (locations.length * (locations.length + 1)) / 2;

  // ── Matrix ──
  let matrix: Record<string, number> = frontendMatrix ? { ...frontendMatrix } : {};

  // ── Strict matrix ──
  let strictMatrix: DistanceMatrix | undefined;
  if (useStrictMatrix) {
    strictMatrix = {};
    for (const key of Object.keys(matrix)) {
      const d = matrix[key];
      strictMatrix[key] = {
        distance: d,
        source: d === undefined || !Number.isFinite(d) ? "unreachable" : "real",
      };
    }
  }

  // ── Pre-filter + consensus ──
  let consensusMatrix: ConsensusMatrix | undefined;
  let consensusElapsedMs = 0;
  let { reachable, unreachable } =
    useStrictMatrix && strictMatrix
      ? filterUnreachable(locations, home, strictMatrix)
      : filterUnreachable(locations, home, matrix);

  if (useConsensus) {
    const tConsensus = Date.now();
    try {
      const consensusPoints: Array<{ lat: number; lng: number }> = [
        { lat: home.lat, lng: home.lng },
        ...locations.map((p) => ({ lat: p.lat, lng: p.lng })),
      ];
      const svc = new RoutingService(defaultProviders);
      const fullConsensus = await svc.buildConsensusMatrix(
        consensusPoints,
        batchProviders,
        undefined,
        onProgress,
      );
      consensusElapsedMs = Date.now() - tConsensus;
      consensusMatrix = fullConsensus;

      // Re-filter: use consensus entries to decide reachability.
      // Track original→new index mapping so we can remap the matrix.
      const newReachable: Location[] = [];
      const newUnreachable: UnreachablePoi[] = [];
      const origToNew = new Map<number, number>();
      for (let i = 0; i < locations.length; i++) {
        const key = `0,${i + 1}`;
        const entry = fullConsensus[key];
        if (
          entry &&
          Number.isFinite(entry.distance) &&
          entry.reliability >= RELIABILITY_FLOOR
        ) {
          origToNew.set(i, newReachable.length);
          newReachable.push(locations[i]);
        } else {
          newUnreachable.push({ ...locations[i], reason: "no_road_connection" });
        }
      }
      reachable = newReachable;
      unreachable = newUnreachable;

      // Remap consensus matrix indices: full matrix uses original indices
      // (0=home, 1..N=all POIs), but the optimizers receive reachable-only
      // indices (0=home, 1..R=reachable POIs). Without remapping, matGet
      // would look up wrong distances.
      if (reachable.length > 0 && origToNew.size > 0) {
        const remapped: ConsensusMatrix = {};
        const origIndices = [...origToNew.keys()];
        for (let ni = 0; ni < reachable.length; ni++) {
          const oi = origIndices[ni]!;
          const homeKey = `0,${oi + 1}`;
          const he = fullConsensus[homeKey];
          if (he) remapped[`0,${ni + 1}`] = he;
        }
        for (let ni = 0; ni < reachable.length; ni++) {
          for (let nj = ni + 1; nj < reachable.length; nj++) {
            const oi = origIndices[ni]! + 1;
            const oj = origIndices[nj]! + 1;
            const ok = oi < oj ? `${oi},${oj}` : `${oj},${oi}`;
            const pe = fullConsensus[ok];
            if (pe) remapped[`${ni + 1},${nj + 1}`] = pe;
          }
        }
        consensusMatrix = remapped;

        // Build an effective flat matrix from consensus for optimizers
        // that don't read consensusMatrix directly (e.g. OrsOptimizer).
        const effective: Record<string, number> = {};
        for (const [key, entry] of Object.entries(remapped)) {
          effective[key] =
            Number.isFinite(entry.distance) && entry.reliability >= RELIABILITY_FLOOR
              ? entry.distance
              : Infinity;
        }
        matrix = effective;
      } else {
        consensusMatrix = undefined;
      }
    } catch (err) {
      console.warn("[API] Consensus build failed:", err);
      consensusMatrix = undefined;
      consensusElapsedMs = Date.now() - tConsensus;
    }
  }

  const unreachableForResponse: UnreachablePoi[] = unreachable;

  // ── Optimizers ──
  const tOpt = Date.now();
  const registry = new OptimizerRegistry(defaultOptimizers);
  const allResults = await registry.runAll({
    locations: reachable,
    home,
    config: normConfig,
    matrix,
    strictMatrix: useStrictMatrix ? strictMatrix : undefined,
    consensusMatrix,
  });

  // ── Post-process: attach provider from consensus matrix to each stop ──
  if (consensusMatrix && Object.keys(consensusMatrix).length > 0) {
    // Build name → matrix-index mapping for reachable POIs
    const nameToIdx = new Map<string, number>();
    reachable.forEach((loc, idx) => nameToIdx.set(loc.name, idx));

    for (const result of allResults) {
      if (!result) continue;
      for (const day of result.days) {
        for (let si = 0; si < day.stops.length - 1; si++) {
          const stopA = day.stops[si]!;
          const stopB = day.stops[si + 1]!;
          // Skip home→home or home→end
          if (stopA.isHome && stopB.isHome) continue;

          const idxA = stopA.isHome ? 0 : (nameToIdx.get(stopA.name) ?? -1) + 1;
          const idxB = stopB.isHome ? 0 : (nameToIdx.get(stopB.name) ?? -1) + 1;
          if (idxA < 0 || idxB < 0) continue;

          const key = idxA < idxB ? `${idxA},${idxB}` : `${idxB},${idxA}`;
          const entry = consensusMatrix[key];
          if (entry && entry.source !== "unreachable") {
            stopB.provider = entry.source;
          }
        }
      }
    }
  }

  let best: OptimizerResult | null = null;
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
    }
  }

  if (best === null) {
    return {
      error:
        "Ningún optimizador pudo resolver el problema. Probá reducir el número de ubicaciones o revisar las conexiones de ruta.",
      status: 500,
    };
  }

  return {
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
  };
}

// ─── POST handler ────────────────────────────────────────────

export async function POST(request: NextRequest) {
  console.log("[API] /api/optimize called");

  try {
    const body = await request.clone().json();
    const useConsensus =
      typeof body.useConsensus === "boolean" ? body.useConsensus : false;

    if (!useConsensus) {
      // Normal JSON response — no streaming.
      const result = await optimize(request);
      if (result.error) {
        return Response.json(result, {
          status: (result as any).status || 500,
        });
      }
      return Response.json(result);
    }

    // Consensus mode — stream progress as NDJSON, final result as last event.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          try {
            controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
          } catch {
            // Stream closed — ignore.
          }
        };

        const progressCb: OnConsensusProgress = (p) => {
          send({ type: "progress", stage: p.stage, current: p.current, total: p.total, detail: p.detail });
        };

        try {
          const result = await optimize(request, progressCb);
          if (result.error) {
            send({ type: "error", error: result.error });
          } else {
            send({ type: "result", data: result });
          }
        } catch (err) {
          console.error("Streaming error:", err);
          send({
            type: "error",
            error: err instanceof Error ? err.message : "Unknown error",
          });
        } finally {
          try { controller.close(); } catch { /* ignore */ }
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson" },
    });
  } catch (error) {
    console.error("Optimization error:", error);
    return Response.json(
      {
        error: "Error interno del servidor.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
