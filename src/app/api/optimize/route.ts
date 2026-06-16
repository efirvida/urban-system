import { NextRequest, NextResponse } from "next/server";
import { Location, Config, OptimizeResponse, NSGAResponse, ApiError } from "@/types";
import { optimizeRoutes } from "@/utils/routerOptimizer";
import { runNSGA2 } from "@/utils/nsga2";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { locations, config, distanceMatrix, algorithm } = body as {
      locations: Location[];
      config: Config;
      distanceMatrix?: Record<string, number>;
      /** "deterministic" (default) or "nsga2" */
      algorithm?: string;
    };

    // ─── Validation ─────────────────────────────────────────

    if (!locations || !Array.isArray(locations) || locations.length === 0) {
      return NextResponse.json(
        { error: "Se requiere al menos una ubicación." } satisfies ApiError,
        { status: 400 }
      );
    }

    if (!config) {
      return NextResponse.json(
        { error: "Falta la configuración del problema." } satisfies ApiError,
        { status: 400 }
      );
    }

    if (
      typeof config.homeLat !== "number" ||
      typeof config.homeLng !== "number"
    ) {
      return NextResponse.json(
        { error: "Coordenadas de casa inválidas." } satisfies ApiError,
        { status: 400 }
      );
    }

    if (
      config.homeLat < -90 ||
      config.homeLat > 90 ||
      config.homeLng < -180 ||
      config.homeLng > 180
    ) {
      return NextResponse.json(
        {
          error: "Coordenadas de casa fuera de rango.",
          details: "Latitud: -90 a 90, Longitud: -180 a 180",
        } satisfies ApiError,
        { status: 400 }
      );
    }

    if (!["hours", "visits", "capacity"].includes(config.constraintType)) {
      return NextResponse.json(
        {
          error: "Tipo de restricción inválido.",
          details: "Usa 'hours', 'visits' o 'capacity'.",
        } satisfies ApiError,
        { status: 400 }
      );
    }

    if (
      typeof config.constraintValue !== "number" ||
      config.constraintValue <= 0
    ) {
      return NextResponse.json(
        {
          error: "Valor de restricción inválido.",
          details: "Debe ser un número positivo.",
        } satisfies ApiError,
        { status: 400 }
      );
    }

    const normalizedConfig: Config = {
      ...config,
      avgSpeed: config.avgSpeed || 60,
      visitTime: config.visitTime || 30,
    };

    // Validate locations
    for (let i = 0; i < locations.length; i++) {
      const loc = locations[i];
      if (!loc.name || typeof loc.name !== "string") {
        return NextResponse.json(
          { error: `Ubicación ${i + 1}: nombre inválido.` } satisfies ApiError,
          { status: 400 }
        );
      }
      if (typeof loc.lat !== "number" || typeof loc.lng !== "number") {
        return NextResponse.json(
          {
            error: `Ubicación "${loc.name}": coordenadas inválidas.`,
          } satisfies ApiError,
          { status: 400 }
        );
      }
    }

    // ─── Optimize ───────────────────────────────────────────

    const startTime = Date.now();

    if (algorithm === "nsga2") {
      const home = { name: "Casa", lat: normalizedConfig.homeLat, lng: normalizedConfig.homeLng };
      const nsgaResult = runNSGA2(locations, home, normalizedConfig, distanceMatrix);

      const response: NSGAResponse = {
        algorithm: "nsga2",
        minDistance: nsgaResult.minDistance,
        minDays: nsgaResult.minDays,
        balanced: nsgaResult.balanced,
        generations: nsgaResult.generations,
        populationSize: nsgaResult.populationSize,
        _debug: nsgaResult._debug,
      };

      return NextResponse.json(response);
    }

    // Default: deterministic Route-First + Local Search
    const result = await optimizeRoutes(locations, normalizedConfig, distanceMatrix);
    const elapsed = Date.now() - startTime;

    const response: OptimizeResponse = {
      days: result.days,
      totalDistance: Math.round(result.totalDistance * 100) / 100,
      totalDays: result.days.length,
      totalLocations: locations.length,
      _meta: {
        elapsedMs: elapsed,
        osrmPairs: result.osrmPairs,
        totalPairs: result.totalPairs,
        routingMode: result.osrmPairs > 0 ? "osrm" : "haversine",
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Optimization error:", error);
    return NextResponse.json(
      {
        error: "Error interno del servidor.",
        details: error instanceof Error ? error.message : "Unknown error",
      } satisfies ApiError,
      { status: 500 }
    );
  }
}
