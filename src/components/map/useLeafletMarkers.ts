"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import { createHomeIcon, createRouteStopIcon, createPinIcon } from "./leafletIcons";

export interface MarkerData {
  routes?: Array<{
    day: number;
    stops: Array<{
      sequence: number; name: string; lat: number; lng: number; isHome?: boolean;
    }>;
  }>;
  locations?: Array<{ name: string; lat: number; lng: number }>;
  home?: { lat: number; lng: number } | null;
  hiddenDays?: Set<number>;
}

interface UseLeafletMarkersOptions {
  data: MarkerData;
  homeDraggable?: boolean;
  onPOIClick?: (lat: number, lng: number, day: number, name: string) => void;
  onDragHome?: (lat: number, lng: number) => void;
  selectedPOI?: { lat: number; lng: number; day: number; name: string } | null;
}

export function useLeafletMarkers(
  mapRef: React.RefObject<L.Map | null>,
  options: UseLeafletMarkersOptions
) {
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const onPOIClickRef = useRef(options.onPOIClick);
  const onDragHomeRef = useRef(options.onDragHome);
  const dataKeyRef = useRef("");

  useEffect(() => {
    onPOIClickRef.current = options.onPOIClick;
    onDragHomeRef.current = options.onDragHome;
  }, [options.onPOIClick, options.onDragHome]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove ALL existing markers from the map
    for (const [, m] of markersRef.current) {
      m.remove();
    }
    markersRef.current.clear();

    const { data } = options;
    const { locations, routes, hiddenDays, home } = data;
    const allPoints: [number, number][] = [];

    // Compute a stable key for the actual spatial data (not visibility state)
    const spatialKey = JSON.stringify([
      locations?.length ?? 0,
      routes?.map(d => `${d.day}:${d.stops.length}`).join(","),
      home?.lat, home?.lng,
    ]);
    const dataChanged = spatialKey !== dataKeyRef.current;

    // ── Home marker (circleMarker — L.marker/L.divIcon no funciona) ──
    if (home && home.lat && home.lng) {
      const circle = L.circleMarker([home.lat, home.lng], {
        radius: 12,
        color: "white",
        weight: 3,
        fillColor: "#f59e0b",
        fillOpacity: 0.9,
      }).addTo(map);
      circle.bindPopup(`<strong>Casa</strong><br/>${home.lat.toFixed(4)}, ${home.lng.toFixed(4)}`);
      allPoints.push([home.lng, home.lat]);
    }

    // ── Location pins (colored dots) usando L.circleMarker (probado, funciona) ──
    if (locations) {
      const assignedCoords = new Set<string>();
      if (routes) {
        for (const day of routes) {
          for (const s of day.stops) {
            if (s.isHome) continue;
            assignedCoords.add(`${s.lat.toFixed(5)},${s.lng.toFixed(5)}`);
          }
        }
      }
      for (let i = 0; i < locations.length; i++) {
        const loc = locations[i];
        const isAssigned = assignedCoords.has(`${loc.lat.toFixed(5)},${loc.lng.toFixed(5)}`);
        // Skip assigned locations — they already have a route stop marker
        if (isAssigned) {
          allPoints.push([loc.lng, loc.lat]);
          continue;
        }
        const circle = L.circleMarker([loc.lat, loc.lng], {
          radius: 8,
          color: "white",
          weight: 2,
          fillColor: "#ef4444",
          fillOpacity: 1,
        }).addTo(map);
        circle.bindPopup(`<strong>${loc.name}</strong><br/>${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}<br/>📍 Sin ruta`);
        markersRef.current.set(`pin-${i}`, circle as any);
        allPoints.push([loc.lng, loc.lat]);
      }
    }

    // ── Route stop markers ──
    // Todos los stops se muestran siempre como círculos de color.
    // Si el día está visible: círculo grande (14) + número + click handler.
    // Si el día está oculto: círculo chico (8) sin número, solo para referencia.
    if (routes) {
      for (const day of routes) {
        const isHidden = hiddenDays?.has(day.day);
        const color = getColor(day.day - 1);
        for (const stop of day.stops) {
          if (stop.isHome) continue;
          const id = `rs-${day.day}-${stop.sequence}`;
          if (isHidden) {
            // Círculo pequeño sin número — muestra que el POI existe pero está en otro día
            const circle = L.circleMarker([stop.lat, stop.lng], {
              radius: 8,
              color: "white",
              weight: 2,
              fillColor: color,
              fillOpacity: 0.5,
            }).addTo(map);
            markersRef.current.set(id, circle as any);
            allPoints.push([stop.lng, stop.lat]);
          } else {
            // Círculo grande con número
            const circle = L.circleMarker([stop.lat, stop.lng], {
              radius: 14,
              color: "white",
              weight: 3,
              fillColor: color,
              fillOpacity: 1,
            }).addTo(map);
            circle.bindTooltip(String(stop.sequence), {
              permanent: true,
              direction: "center",
              className: "route-stop-label",
            });
            circle.bindPopup(
              `<strong>${stop.name}</strong><br/>Día ${day.day} · #${stop.sequence}<br/>${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}`
            );
            (circle as any)._poiData = { lat: stop.lat, lng: stop.lng, day: day.day, name: stop.name };
            circle.on("click", () => {
              const d = (circle as any)._poiData as { lat: number; lng: number; day: number; name: string } | undefined;
              if (d && onPOIClickRef.current) {
                onPOIClickRef.current(d.lat, d.lng, d.day, d.name);
              }
            });
            markersRef.current.set(id, circle as any);
            allPoints.push([stop.lng, stop.lat]);
          }
        }
      }
    }

    // Fit bounds — solo si los datos espaciales realmente cambiaron
    if (dataChanged && allPoints.length > 0) {
      dataKeyRef.current = spatialKey;
      try {
        const bounds = L.latLngBounds(allPoints.map((p) => [p[1], p[0]] as [number, number]));
        map.fitBounds(bounds, { padding: [80, 80], maxZoom: 16 });
      } catch {}
    }
  }, [mapRef, options]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selected POI highlight
  useEffect(() => {
    const sel = options.selectedPOI;
    for (const [, marker] of markersRef.current) {
      const el = marker.getElement() as HTMLElement | null;
      if (!el) continue;
      const poiData = (marker as any)._poiData as { lat: number; lng: number; day: number } | undefined;
      const isMatch = sel && poiData &&
        poiData.day === sel.day &&
        Math.abs(poiData.lat - sel.lat) < 0.000001 &&
        Math.abs(poiData.lng - sel.lng) < 0.000001;
      if (isMatch) {
        el.style.transform = "scale(1.4)";
        el.style.boxShadow = "0 0 0 4px rgba(59, 130, 246, 0.6), 0 0 0 6px rgba(59, 130, 246, 0.3)";
        el.style.zIndex = "20";
      } else {
        el.style.transform = "";
        el.style.boxShadow = "";
        el.style.zIndex = "";
      }
    }
  }, [options.selectedPOI, options.data]);

  return { markersRef };
}

const ROUTE_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899",
  "#06b6d4", "#f97316", "#14b8a6", "#6366f1", "#84cc16", "#d946ef",
];

function getColor(index: number): string {
  return ROUTE_COLORS[index % ROUTE_COLORS.length];
}
