import { NextRequest, NextResponse } from "next/server";
import { Location, Config, OptimizeResponse, ApiError } from "@/types";
import { optimizeRoutes } from "@/utils/routerOptimizer";
import { buildGoogleMatrix } from "@/utils/googleRouting";
import { improveWithGA } from "@/utils/geneticOptimizer";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { locations, config, distanceMatrix: clientMatrix, googleMapsKey: clientKey } = body as {
      locations: Location[];
      config: Config;
      distanceMatrix?: Record<string, number>;
      googleMapsKey?: string;
    };

    // Resolve distance matrix (priority: client → Google Maps → Haversine)
    let distanceMatrix = clientMatrix;

    if (!distanceMatrix || Object.keys(distanceMatrix).length === 0) {
      const googleKey = process.env.GOOGLE_MAPS_API_KEY || clientKey;
      if (googleKey && locations.length > 0) {
        const all = [{ lat: config.homeLat, lng: config.homeLng }, ...locations];
        const result = await buildGoogleMatrix(all, googleKey);
        distanceMatrix = result.matrix;
      } else {
        // Pure Haversine fallback (instant)
        distanceMatrix = {};
        const { haversineDistance } = await import("@/utils/haversine");
        const all = [{ lat: config.homeLat, lng: config.homeLng }, ...locations];
        for (let i = 0; i < all.length; i++) {
          for (let j = i + 1; j < all.length; j++) {
            const key = `${i},${j}`;
            distanceMatrix[key] = haversineDistance(all[i].lat, all[i].lng, all[j].lat, all[j].lng);
          }
        }
      }
    }

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

    // Route-First + Local Search
    const base = await optimizeRoutes(locations, normalizedConfig, distanceMatrix);
    let finalDays = base.days;
    let finalDist = base.totalDistance;

    // GA post-optimization
    if (locations.length >= 5) {
      const home = { name: "Casa", lat: normalizedConfig.homeLat, lng: normalizedConfig.homeLng };
      const initialPerm: number[] = [];
      for (const day of base.days) {
        for (const stop of day.stops) {
          if (stop.isHome) continue;
          const idx = locations.findIndex(l => l.lat === stop.lat && l.lng === stop.lng);
          if (idx >= 0) initialPerm.push(idx);
        }
      }
      if (initialPerm.length === locations.length) {
        try {
          const gaResult = await improveWithGA(initialPerm, locations, home, normalizedConfig, distanceMatrix);
          if (gaResult.totalDistance < finalDist) {
            finalDays = gaResult.days;
            finalDist = gaResult.totalDistance;
          }
        } catch {}
      }
    }

    const elapsed = Date.now() - startTime;

    const response: OptimizeResponse = {
      days: finalDays,
      totalDistance: Math.round(finalDist * 100) / 100,
      totalDays: finalDays.length,
      totalLocations: locations.length,
      _meta: {
        elapsedMs: elapsed,
        osrmPairs: base.osrmPairs,
        totalPairs: base.totalPairs,
        routingMode: base.osrmPairs > 0 ? "osrm" : "haversine",
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
