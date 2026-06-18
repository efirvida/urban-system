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

    // ── Home marker ──
    if (home && home.lat && home.lng) {
      const marker = L.marker([home.lat, home.lng], {
        icon: createHomeIcon(!!options.homeDraggable),
        draggable: !!options.homeDraggable,
      }).addTo(map);
      marker.bindPopup(`<strong>Casa</strong><br/>${home.lat.toFixed(4)}, ${home.lng.toFixed(4)}`);
      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        onDragHomeRef.current?.(pos.lat, pos.lng);
      });
      markersRef.current.set("home", marker);
      allPoints.push([home.lng, home.lat]);
    }

    // ── Location pins (colored dots) ──
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
        const marker = L.marker([loc.lat, loc.lng], {
          icon: createPinIcon(isAssigned),
          interactive: false,
        }).addTo(map);
        const dayInfo = routes
          ?.flatMap(d => d.stops.filter(s => !s.isHome && Math.abs(s.lat - loc.lat) < 0.00001 && Math.abs(s.lng - loc.lng) < 0.00001).map(s => `Día ${d.day}`))
          .join(", ");
        marker.bindPopup(
          `<strong>${loc.name}</strong><br/>${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}${dayInfo ? `<br/>${dayInfo}` : "<br/>📍 Sin ruta"}`
        );
        markersRef.current.set(`loc-${i}`, marker);
        allPoints.push([loc.lng, loc.lat]);
      }
    }

    // ── Route stop markers (numbered circles) ──
    if (routes) {
      for (const day of routes) {
        const isHidden = hiddenDays?.has(day.day);
        const color = getColor(day.day - 1);
        for (const stop of day.stops) {
          if (stop.isHome) continue;
          if (isHidden) continue;
          const id = `rs-${day.day}-${stop.sequence}`;
          const marker = L.marker([stop.lat, stop.lng], {
            icon: createRouteStopIcon(stop.sequence, color),
          }).addTo(map);
          marker.bindPopup(
            `<strong>${stop.name}</strong><br/>Día ${day.day} · #${stop.sequence}<br/>${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}`
          );
          (marker as any)._poiData = { lat: stop.lat, lng: stop.lng, day: day.day, name: stop.name };
          marker.on("click", () => {
            const d = (marker as any)._poiData as { lat: number; lng: number; day: number; name: string } | undefined;
            if (d && onPOIClickRef.current) {
              onPOIClickRef.current(d.lat, d.lng, d.day, d.name);
            }
          });
          markersRef.current.set(id, marker);
          allPoints.push([stop.lng, stop.lat]);
        }
      }
    }

    // Fit bounds
    if (allPoints.length > 0) {
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
