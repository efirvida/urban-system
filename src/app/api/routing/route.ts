/**
 * Route geometry API — returns driving route between stops.
 * Priority: Geoapify > OSRM > Haversine (straight line)
 *
 * POST /api/routing
 * Body: { stops: [{ lat, lng }] }
 * Response: { coordinates: [[lng,lat],...], distance: km, time: s, legs: [{from,to,distance,time}] }
 */

import { NextRequest, NextResponse } from "next/server";
import { haversineDistance } from "@/utils/haversine";

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

function makeStraightLine(stops: RouteStop[]): RouteResponse {
  const coordinates: [number, number][] = [];
  const legs: RouteLeg[] = [];
  let totalDist = 0;
  let totalTime = 0;

  for (let i = 0; i < stops.length; i++) {
    coordinates.push([stops[i].lng, stops[i].lat]);
    if (i > 0) {
      const d = haversineDistance(stops[i - 1].lat, stops[i - 1].lng, stops[i].lat, stops[i].lng);
      const t = (d / 60) * 3600; // ~60 km/h → seconds
      totalDist += d;
      totalTime += t;
      legs.push({ from: i - 1, to: i, distance: d, time: t });
    }
  }
  return { coordinates, distance: Math.round(totalDist * 100) / 100, time: Math.round(totalTime), legs, source: "haversine" };
}

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

    const legs: RouteLeg[] = [];
    let cumDist = 0;
    for (let i = 1; i < stops.length; i++) {
      const d = haversineDistance(stops[i - 1].lat, stops[i - 1].lng, stops[i].lat, stops[i].lng);
      // Approximate leg distance proportionally from total
      const legDist = (d / (totalDist || 1)) * totalDist;
      const legTime = (legDist / (totalDist || 1)) * totalTime;
      cumDist += legDist;
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
  // Geoapify Routing API uses GET with waypoints in the URL
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

    // Build legs from cumulative distance at waypoints
    const legs: RouteLeg[] = [];
    if (props.waypoints && props.waypoints.length > 0) {
      // We only have start and end waypoints from the URL, not intermediate ones
      // Estimate legs proportionally
      let cumH = 0;
      for (let i = 1; i < stops.length; i++) {
        const d = haversineDistance(stops[i - 1].lat, stops[i - 1].lng, stops[i].lat, stops[i].lng);
        cumH += d;
        const ratio = cumH / (cumH || 1);
        const legDist = totalDist * (d / (cumH || 1));
        const legTime = totalTime * (d / (cumH || 1));
        legs.push({ from: i - 1, to: i, distance: Math.round(legDist * 100) / 100, time: Math.round(legTime) });
      }
    } else {
      let cumDist = 0;
      for (let i = 1; i < stops.length; i++) {
        const d = haversineDistance(stops[i - 1].lat, stops[i - 1].lng, stops[i].lat, stops[i].lng);
        const legDist = (d / (totalDist || 1)) * totalDist;
        const legTime = (legDist / (totalDist || 1)) * totalTime;
        legs.push({ from: i - 1, to: i, distance: Math.round(legDist * 100) / 100, time: Math.round(legTime) });
      }
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

    // Priority 3: Haversine straight line
    return NextResponse.json(makeStraightLine(stops));
  } catch (error) {
    console.error("[Routing] Error:", error);
    return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
  }
}
