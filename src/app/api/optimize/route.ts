import { NextRequest, NextResponse } from "next/server";
import { Location, Config, ParetoSolution, OptimizeResponse, NSGAResponse, ApiError } from "@/types";
import { optimizeRoutes } from "@/utils/routerOptimizer";
import { runNSGA2 } from "@/utils/nsga2";
import { buildGeoapifyMatrix } from "@/utils/geoapifyMatrix";
import { haversineDistance } from "@/utils/haversine";

function buildHaversineMatrix(locations: Location[], config: Config): Record<string, number> {
  const matrix: Record<string, number> = {};
  const all = [{ lat: config.homeLat, lng: config.homeLng }, ...locations];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      matrix[`${i},${j}`] = haversineDistance(all[i].lat, all[i].lng, all[j].lat, all[j].lng);
  return matrix;
}

export async function POST(request: NextRequest) {
  console.log("[API] /api/optimize called");
  const startTime = Date.now();
  try {
    const body = await request.json();
    const { locations, config, algorithm, distanceMatrix: frontendMatrix, geoapifyTried } = body as {
      locations: Location[];
      config: Config;
      algorithm?: string;
      distanceMatrix?: Record<string, number>;
      geoapifyTried?: string[];
    };

    const triedCount = geoapifyTried?.length ?? 0;
    console.log("[API] Body:", { locations: locations?.length, algorithm, hasMatrix: !!frontendMatrix, geoapifyTried: triedCount });

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
          if (Math.abs(geoMatrix[key] - haversineRef[key]) > 0.01) {
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
        else if (Math.abs(matrix[key] - havRef[key]) > 0.1) osmCount++;
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

    // ── Step 3: Run BOTH algorithms and pick the best ──
    const tOpt = Date.now();

    // Deterministic + GA
    const autoResult = await optimizeRoutes(locations, normConfig, matrix);
    const autoDistance = Math.round(autoResult.totalDistance * 100) / 100;
    const autoDays = autoResult.days.length;
    console.log(`[API] Auto: ${autoDays}d, ${autoDistance}km in ${Date.now() - tOpt}ms`);

    // NSGA2
    let nsgaData: Record<string, unknown> | null = null;
    try {
      const nsgaPromise = runNSGA2(locations, home, normConfig, matrix);
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
      _meta: { elapsedMs: Date.now() - startTime, osrmPairs: Object.keys(matrix).length, totalPairs, routingMode },
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
