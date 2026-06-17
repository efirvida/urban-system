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

    const { data } = options;
    const markers = markersRef.current;
    const keepIds = new Set<string>();
    const allPoints: [number, number][] = [];

    // Home marker
    if (data.home && data.home.lat && data.home.lng) {
      const homeId = "home";
      keepIds.add(homeId);
      const existing = markers.get(homeId);
      if (existing) {
        existing.setLatLng([data.home.lat, data.home.lng]);
      } else {
        const marker = L.marker([data.home.lat, data.home.lng], {
          icon: createHomeIcon(!!options.homeDraggable),
          draggable: !!options.homeDraggable,
        }).addTo(map);
        marker.bindPopup(`<strong>Casa</strong><br/>${data.home.lat.toFixed(4)}, ${data.home.lng.toFixed(4)}`);
        marker.on("dragend", () => {
          const pos = marker.getLatLng();
          onDragHomeRef.current?.(pos.lat, pos.lng);
        });
        markers.set(homeId, marker);
      }
      allPoints.push([data.home.lng, data.home.lat]);
    }

    // Update home draggability
    if (options.homeDraggable !== undefined) {
      const homeMarker = markers.get("home");
      if (homeMarker) {
        if (options.homeDraggable) homeMarker.dragging?.enable();
        else homeMarker.dragging?.disable();
      }
    }

    // Location pins (only when not editing)
    if (data.locations) {
      for (let i = 0; i < data.locations.length; i++) {
        const loc = data.locations[i];
        const id = `loc-${i}`;
        keepIds.add(id);
        const existing = markers.get(id);
        if (existing) {
          existing.setLatLng([loc.lat, loc.lng]);
        } else {
          const marker = L.marker([loc.lat, loc.lng], {
            icon: createPinIcon(),
            interactive: false,
          }).addTo(map);
          marker.bindPopup(`<strong>${loc.name}</strong><br/>${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`);
          markers.set(id, marker);
        }
        allPoints.push([loc.lng, loc.lat]);
      }
    }

    // Route stop markers
    if (data.routes) {
      for (const day of data.routes) {
        const isHidden = data.hiddenDays?.has(day.day);
        const color = getColor(day.day - 1);

        for (const stop of day.stops) {
          if (stop.isHome) continue;
          const id = `rs-${day.day}-${stop.sequence}`;

          if (isHidden) {
            const existing = markers.get(id);
            if (existing) { existing.remove(); markers.delete(id); }
            continue;
          }

          keepIds.add(id);
          const existing = markers.get(id);
          if (existing) {
            existing.setLatLng([stop.lat, stop.lng]);
            // Store POI data on marker for selection highlight
            (existing as any)._poiData = { lat: stop.lat, lng: stop.lng, day: day.day, name: stop.name };
          } else {
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
            markers.set(id, marker);
          }
          allPoints.push([stop.lng, stop.lat]);
        }
      }
    }

    // Remove stale markers
    for (const [id, marker] of markers) {
      if (!keepIds.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }

    // Fit bounds if we have points
    if (allPoints.length > 0 && map) {
      try {
        const bounds = L.latLngBounds(allPoints.map((p) => [p[1], p[0]] as [number, number]));
        map.fitBounds(bounds, { padding: [80, 80], maxZoom: 16 });
      } catch {}
    }
  }, [mapRef, options.data, options.homeDraggable]); // eslint-disable-line react-hooks/exhaustive-deps

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
