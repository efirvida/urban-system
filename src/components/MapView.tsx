"use client";

import { useRef, useEffect } from "react";
import L from "leaflet";
import { Car } from "lucide-react";
import { useLeafletMap } from "./map/useLeafletMap";
import { useLeafletMarkers } from "./map/useLeafletMarkers";
import { useLeafletRoutes } from "./map/useLeafletRoutes";
import type { ValidatedRow, Location, DayRoute } from "@/types";
import type { RouteSource } from "@/utils/clientRouting";

// ─── Types (preserved 1:1 for backwards compat) ───────────────

/** Real-road sources — anything that isn't Haversine or undefined. */
const REAL_ROAD_SOURCES = new Set([
  "geoapify", "geoapify-matrix", "ors", "ors-matrix", "osrm",
]);

export interface MapViewData {
  markers?: ValidatedRow[];
  locations?: Location[];
  routes?: DayRoute[];
  home?: { lat: number; lng: number } | null;
  hiddenDays?: Set<number>;
  routingMode?: RouteSource | "haversine";
  routeGeometry?: Map<number, [number, number][]>;
  routeSource?: Map<number, RouteSource>;
}

interface MapViewProps {
  data: MapViewData;
  placementMode?: "home" | null;
  onPlaceHome?: (lat: number, lng: number) => void;
  onDragHome?: (lat: number, lng: number) => void;
  homeDraggable?: boolean;
  onPOIClick?: (lat: number, lng: number, day: number, name: string) => void;
  highlightDay?: number | null;
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

  const { mapRef, invalidateSize } = useLeafletMap(containerRef, {
    onPlaceHome,
    placementMode,
  });

  useEffect(() => {
    const id = requestAnimationFrame(() => invalidateSize());
    return () => cancelAnimationFrame(id);
  }, [invalidateSize]);

  // Routes (polylines + stop markers) — single hook, single LayerGroup per day
  useLeafletRoutes(mapRef, {
    routes: data.routes,
    routeGeometry: data.routeGeometry,
    routeSource: data.routeSource,
    hiddenDays: data.hiddenDays,
    highlightDay,
    onPOIClick,
    selectedPOI,
  });

  // Home + location pins (non-route markers)
  useLeafletMarkers(mapRef, {
    data,
    homeDraggable,
    onDragHome,
    selectedPOI,
  });

  // ValidatedRow markers (review phase)
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

    for (const [id, marker] of markers) {
      if (!keepIds.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }

    if (data.markers && data.markers.length > 0 && !data.routes && !data.locations && allPoints.length > 0) {
      try {
        const bounds = L.latLngBounds(allPoints.map((p) => [p[1], p[0]] as [number, number]));
        map.fitBounds(bounds, { padding: [80, 80], maxZoom: 16 });
      } catch {}
    }
  }, [mapRef, data.markers]);

  return (
    <div className="absolute inset-0 z-0" style={{ width: "100%", height: "100%" }}>
      {data.routingMode && (
        <div className="absolute bottom-4 left-4 z-10 px-2.5 py-1 bg-white/90 backdrop-blur-sm rounded-full shadow text-xs text-gray-500 border flex items-center gap-1.5">
          {REAL_ROAD_SOURCES.has(data.routingMode) ? (
            <>
              <Car className="w-3.5 h-3.5" />
              Ruta real
            </>
          ) : (
            <span>📏 Línea recta</span>
          )}
        </div>
      )}

      {placementMode === "home" && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 bg-blue-600 text-white rounded-full shadow-lg text-sm font-medium whitespace-nowrap">
          🏠 Haz clic en el mapa para colocar la casa
        </div>
      )}

      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
