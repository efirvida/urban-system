"use client";

import { useRef, useEffect } from "react";
import L from "leaflet";
import { Car } from "lucide-react";
import { useLeafletMap } from "./map/useLeafletMap";
import { useLeafletMarkers } from "./map/useLeafletMarkers";
import { useLeafletPolylines } from "./map/useLeafletPolylines";
import type { ValidatedRow, Location, DayRoute } from "@/types";
import type { RouteSource } from "@/utils/clientRouting";

// ─── Types (preserved 1:1 for backwards compat) ───────────────

export interface MapViewData {
  markers?: ValidatedRow[];
  locations?: Location[];
  routes?: DayRoute[];
  home?: { lat: number; lng: number } | null;
  /** Days to hide from the map (day numbers, 1-based) */
  hiddenDays?: Set<number>;
  /** Which routing mode is being displayed */
  routingMode?: "osrm" | "haversine";
  /** Road-following geometry: dayNumber → [lng,lat][] for drawing real routes */
  routeGeometry?: Map<number, [number, number][]>;
  /** Per-day routing source — drives dashed line styling for estimated routes.
   *  When missing or "haversine", the day renders as dashed (estimated).
   *  When "osrm" or "geoapify", the day renders as solid (real road). */
  routeSource?: Map<number, RouteSource>;
}

interface MapViewProps {
  data: MapViewData;
  /** When true, clicking the map sets home coordinates */
  placementMode?: "home" | null;
  /** Called when user clicks to place home */
  onPlaceHome?: (lat: number, lng: number) => void;
  /** Called when user drags home marker */
  onDragHome?: (lat: number, lng: number) => void;
  /** When true, the home marker can be dragged (default false) */
  homeDraggable?: boolean;
  /** Called when user clicks a route stop (POI) in a route */
  onPOIClick?: (lat: number, lng: number, day: number, name: string) => void;
  /** Day to highlight (dim others) */
  highlightDay?: number | null;
  /** Currently-selected POI — the matching marker is scaled up
   *  and ringed with a blue glow. */
  selectedPOI?: { lat: number; lng: number; day: number; name: string } | null;
}

// ─── Component ───────────────────────────────────────────────

export default function MapView({
  data,
  placementMode,
  onPlaceHome,
  onDragHome,
  homeDraggable,
  onPOIClick,
  highlightDay,
  selectedPOI,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Map lifecycle (init, OSM tiles, controls, placement-mode click + cursor)
  const { mapRef, invalidateSize } = useLeafletMap(containerRef, {
    onPlaceHome,
    placementMode,
  });

  // Stabilize marker-data reference for the hook's effect dep. With page.tsx's
  // useMemo on mapData, this is already stable — the ref adds defensive
  // protection in case the parent stops memoizing.
  const markerData = useRef(data);
  markerData.current = data;

  // Home + location pins + route-stop markers (with click → onPOIClick, drag → onDragHome)
  useLeafletMarkers(mapRef, {
    data: markerData.current,
    homeDraggable,
    onPOIClick,
    onDragHome,
    selectedPOI,
  });

  // Per-day glow + route polylines (hiddenDays, highlightDay, routeGeometry, routeSource)
  useLeafletPolylines(mapRef, {
    routes: data.routes,
    routeGeometry: data.routeGeometry,
    routeSource: data.routeSource,
    hiddenDays: data.hiddenDays,
    highlightDay,
  });

  // ValidatedRow markers (review phase) — small pin dots with selected/unselected
  // state. The useLeafletMarkers hook handles Location[]/routes/home but not the
  // ValidatedRow[] from the review phase, so we render these inline to preserve
  // backwards compat (selected rows = blue solid, unselected = gray faded).
  // Safe to import L at top — MapView is loaded via next/dynamic with ssr:false
  // in page.tsx, so the module never evaluates during Next.js prerender.
  const validatedMarkersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const markers = validatedMarkersRef.current;
    const keepIds = new Set<string>();
    const allPoints: [number, number][] = [];

    if (data.markers) {
      for (const row of data.markers) {
        if (row.lat === null || row.lng === null) continue;
        keepIds.add(row.id);
        const style = {
          fillColor: row.selected ? "#3b82f6" : "#9ca3af",
          fillOpacity: row.selected ? 1 : 0.4,
        };
        const existing = markers.get(row.id);
        if (existing) {
          existing.setLatLng([row.lat, row.lng]);
          existing.setStyle(style);
        } else {
          const m = L.circleMarker([row.lat, row.lng], {
            radius: 6,
            color: "white",
            weight: 2,
            ...style,
          }).addTo(map);
          markers.set(row.id, m);
        }
        allPoints.push([row.lng, row.lat]);
      }
    }

    // Remove stale markers
    for (const [id, marker] of markers) {
      if (!keepIds.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }

    // Fit bounds when no other markers are present (review-phase-only screen)
    if (
      data.markers &&
      data.markers.length > 0 &&
      !data.routes &&
      !data.locations &&
      allPoints.length > 0
    ) {
      try {
        const bounds = L.latLngBounds(
          allPoints.map((p) => [p[1], p[0]] as [number, number])
        );
        map.fitBounds(bounds, { padding: [80, 80], maxZoom: 16 });
      } catch {
        // bounds can fail on bad data; ignore
      }
    }
  }, [mapRef, data.markers]);

  // Invalidate size after first paint. Leaflet caches the container size at
  // init; if the layout wasn't ready (e.g. CSS not applied), the map renders
  // into a 0×0 box. requestAnimationFrame defers until after the browser
  // has laid out the container.
  useEffect(() => {
    const id = requestAnimationFrame(() => invalidateSize());
    return () => cancelAnimationFrame(id);
  }, [invalidateSize]);

  return (
    <div className="absolute inset-0" style={{ width: "100%", height: "100%" }}>
      {/* Routing mode badge (bottom-left of map) */}
      {data.routingMode && (
        <div className="absolute bottom-4 left-4 z-10 px-2.5 py-1 bg-white/90 backdrop-blur-sm rounded-full shadow text-xs text-gray-500 border flex items-center gap-1.5">
          {data.routingMode === "osrm" ? (
            <>
              <Car className="w-3.5 h-3.5" />
              Ruta real
            </>
          ) : (
            <span>📏 Línea recta</span>
          )}
        </div>
      )}

      {/* Placement mode overlay indicator */}
      {placementMode === "home" && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 bg-blue-600 text-white rounded-full shadow-lg text-sm font-medium whitespace-nowrap">
          🏠 Haz clic en el mapa para colocar la casa
        </div>
      )}

      {/* Map container */}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
