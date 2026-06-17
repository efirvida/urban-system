import { NextRequest, NextResponse } from "next/server";
import { Location, Config, OptimizeResponse, NSGAResponse, ApiError } from "@/types";
import { optimizeRoutes } from "@/utils/routerOptimizer";
import { runNSGA2 } from "@/utils/nsga2";
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
  const startTime = Date.now();
  try {
    const body = await request.json();
    const { locations, config, algorithm } = body as {
      locations: Location[];
      config: Config;
      algorithm?: string;
    };

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

    // Build distance matrix server-side (instant Haversine)
    const distanceMatrix = buildHaversineMatrix(locations, normConfig);
    const home = { name: "Casa", lat: normConfig.homeLat, lng: normConfig.homeLng };

    if (algorithm === "nsga2") {
      // NSGA2 with 10s timeout
      const nsgaPromise = runNSGA2(locations, home, normConfig, distanceMatrix);
      const timeoutPromise = new Promise<null>(r => setTimeout(() => r(null), 10000));
      const nsgaResult = await Promise.race([nsgaPromise, timeoutPromise]);
      if (!nsgaResult) {
        return NextResponse.json({ error: "NSGA2 timeout. Probá con modo Auto." } satisfies ApiError, { status: 408 });
      }

      return NextResponse.json({
        algorithm: "nsga2",
        balanced: nsgaResult.balanced,
        minDistance: nsgaResult.minDistance,
        minDuration: nsgaResult.minDuration,
        paretoFront: nsgaResult.paretoFront,
        totalEvaluations: nsgaResult.totalEvaluations,
        _meta: { elapsedMs: Date.now() - startTime, osrmPairs: 0, totalPairs: (locations.length * (locations.length + 1)) / 2, routingMode: "haversine" },
      } satisfies NSGAResponse);
    }

    // Deterministic
    const result = await optimizeRoutes(locations, normConfig, distanceMatrix);
    return NextResponse.json({
      days: result.days,
      totalDistance: Math.round(result.totalDistance * 100) / 100,
      totalDays: result.days.length,
      totalLocations: locations.length,
      _meta: { elapsedMs: Date.now() - startTime, osrmPairs: result.osrmPairs, totalPairs: result.totalPairs, routingMode: "haversine" },
    } satisfies OptimizeResponse);

  } catch (error) {
    console.error("Optimization error:", error);
    return NextResponse.json({ error: "Error interno del servidor.", details: error instanceof Error ? error.message : "Unknown" } satisfies ApiError, { status: 500 });
  }
}
