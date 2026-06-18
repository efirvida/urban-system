/**
 * Route geometry API — returns driving route between stops.
 * Priority: Geoapify > OSRM (no Haversine fallback).
 *
 * POST /api/routing
 * Body: { stops: [{ lat, lng }] }
 * Response: { coordinates: [[lng,lat],...], distance: km, time: s, legs: [{from,to,distance,time}] }
 */

import { NextRequest, NextResponse } from "next/server";

// ─── Types ───────────────────────────────────────────────────

interface RouteStop {
  lat: number;
  lng: number;
}

interface RouteLeg {
  from: number;
  to: number;
  distance: number; // km
  time: number;     // seconds
}

interface RouteResponse {
  coordinates: [number, number][];
  distance: number;
  time: number;
  legs: RouteLeg[];
  source: "geoapify" | "osrm" | "haversine";
}

// ─── Helpers ─────────────────────────────────────────────────

async function tryOSRM(stops: RouteStop[]): Promise<RouteResponse | null> {
  if (stops.length < 2) return null;
  const coords = stops.map(s => `${s.lng},${s.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false&alternatives=false`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.length) return null;

    const route = data.routes[0];
    const coordinates: [number, number][] = route.geometry?.coordinates?.map((c: number[]) => [c[0], c[1] as number]) || [];
    const totalDist = route.distance / 1000; // meters → km
    const totalTime = route.duration; // seconds

    const numLegs = stops.length - 1;
    const legDist = totalDist / numLegs;
    const legTime = totalTime / numLegs;
    const legs: RouteLeg[] = [];
    for (let i = 1; i <= numLegs; i++) {
      legs.push({ from: i - 1, to: i, distance: Math.round(legDist * 100) / 100, time: Math.round(legTime) });
    }

    return {
      coordinates,
      distance: Math.round(totalDist * 100) / 100,
      time: Math.round(totalTime),
      legs,
      source: "osrm",
    };
  } catch {
    return null;
  }
}

async function tryGeoapify(stops: RouteStop[], apiKey: string): Promise<RouteResponse | null> {
  if (stops.length < 2) return null;
  const waypoints = stops.map(s => `${s.lng},${s.lat}`).join("|");
  const url = `https://api.geoapify.com/v1/routing?waypoints=${waypoints}&mode=drive&type=short&apiKey=${apiKey}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const data = await res.json();

    if (!data.features?.length) return null;
    const feature = data.features[0];
    const props = feature.properties || {};

    const coordinates: [number, number][] = feature.geometry?.coordinates?.map((c: number[]) => [c[0], c[1] as number]) || [];
    const totalDist = (props.distance?.value || 0) / 1000;
    const totalTime = props.time?.value || 0;

    const numLegs = stops.length - 1;
    const legDist = totalDist / numLegs;
    const legTime = totalTime / numLegs;
    const legs: RouteLeg[] = [];
    for (let i = 1; i <= numLegs; i++) {
      legs.push({ from: i - 1, to: i, distance: Math.round(legDist * 100) / 100, time: Math.round(legTime) });
    }

    return {
      coordinates,
      distance: Math.round(totalDist * 100) / 100,
      time: Math.round(totalTime),
      legs,
      source: "geoapify",
    };
  } catch {
    return null;
  }
}

// ─── POST handler ────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { stops } = body as { stops?: RouteStop[] };

    if (!stops || stops.length < 2) {
      return NextResponse.json({ error: "Se requieren al menos 2 paradas." }, { status: 400 });
    }

    const geoapifyKey = process.env.GEOAPIFY_API_KEY;

    // Priority 1: Geoapify
    if (geoapifyKey) {
      const result = await tryGeoapify(stops, geoapifyKey);
      if (result) return NextResponse.json(result);
    }

    // Priority 2: OSRM
    const osrmResult = await tryOSRM(stops);
    if (osrmResult) return NextResponse.json(osrmResult);

    // Priority 3: No real route found
    return NextResponse.json({
      coordinates: [],
      distance: 0,
      time: 0,
      legs: [],
      source: "haversine" as const,
    });
  } catch (error) {
    console.error("[Routing] Error:", error);
    return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
  }
}
