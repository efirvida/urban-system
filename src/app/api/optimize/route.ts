import { NextRequest, NextResponse } from "next/server";
import { Location, Config, OptimizeResponse, NSGAResponse, ApiError } from "@/types";
import { optimizeRoutes } from "@/utils/routerOptimizer";

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
      // Three solutions with different constraint loads:
      //   minDist = 0.7x (stricter → more days, less km/day → lower total)
      //   minDays = 1.3x (looser → fewer days, more km/day → higher total)
      //   balanced = 1.0x (as configured by user)
      const multipliers = [
        { key: "minDistance", mult: 0.7 },
        { key: "minDays", mult: 1.3 },
        { key: "balanced", mult: 1.0 },
      ] as const;

      const solutions = await Promise.all(multipliers.map(async ({ key, mult }) => {
        const cfg = { ...normalizedConfig, constraintValue: normalizedConfig.constraintValue * mult };
        // Prevent negative/zero constraint
        if (cfg.constraintValue < 1) cfg.constraintValue = 1;
        const result = await optimizeRoutes(locations, cfg, distanceMatrix);
        return { key, result };
      }));

      const byKey = (k: string) => solutions.find(s => s.key === k)!;
      const toPareto = (r: typeof solutions[0]["result"]) => ({
        days: r.days.length,
        totalDistance: r.totalDistance,
        routes: r.days.map(d => d.stops.filter(s => !s.isHome).length > 0 ? d.stops.filter(s => !s.isHome).map(s => -1) : []),
        dayRoutes: r.days,
      });

      // Build response
      const nsgaResponse: NSGAResponse = {
        algorithm: "nsga2",
        minDistance: { days: byKey("minDistance").result.days.length, totalDistance: Math.round(byKey("minDistance").result.totalDistance * 100) / 100, routes: [], dayRoutes: byKey("minDistance").result.days },
        minDays: { days: byKey("minDays").result.days.length, totalDistance: Math.round(byKey("minDays").result.totalDistance * 100) / 100, routes: [], dayRoutes: byKey("minDays").result.days },
        balanced: { days: byKey("balanced").result.days.length, totalDistance: Math.round(byKey("balanced").result.totalDistance * 100) / 100, routes: [], dayRoutes: byKey("balanced").result.days },
        generations: 3,
        populationSize: 3,
        _meta: {
          elapsedMs: Date.now() - startTime,
          osrmPairs: distanceMatrix ? Object.keys(distanceMatrix).length : 0,
          totalPairs: (locations.length * (locations.length + 1)) / 2,
          routingMode: distanceMatrix ? "osrm" : "haversine",
        },
      };

      return NextResponse.json(nsgaResponse);
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
