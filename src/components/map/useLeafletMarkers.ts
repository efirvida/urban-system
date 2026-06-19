"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";

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
  onDragHome?: (lat: number, lng: number) => void;
  selectedPOI?: { lat: number; lng: number; day: number; name: string } | null;
}

export function useLeafletMarkers(
  mapRef: React.RefObject<L.Map | null>,
  options: UseLeafletMarkersOptions
) {
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const onDragHomeRef = useRef(options.onDragHome);
  const dataKeyRef = useRef("");

  useEffect(() => {
    onDragHomeRef.current = options.onDragHome;
  }, [options.onDragHome]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

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
    if (dataChanged) dataKeyRef.current = spatialKey;

    // Remove ALL existing markers from the map (rápido, no noticeable flicker)
    for (const [, m] of markersRef.current) {
      m.remove();
    }
    markersRef.current.clear();

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
        (circle as any)._poiData = { lat: loc.lat, lng: loc.lng, day: -1, name: loc.name };
        markersRef.current.set(`pin-${i}`, circle as any);
        allPoints.push([loc.lng, loc.lat]);
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

  // Selected POI highlight — solo para pins de ubicaciones no asignadas
  // (los route stop markers se manejan en useLeafletRoutes)
  useEffect(() => {
    const sel = options.selectedPOI;
    for (const [, marker] of markersRef.current) {
      const poiData = (marker as any)._poiData as { lat: number; lng: number; day: number } | undefined;
      if (!poiData) continue;
      const isMatch = sel &&
        poiData.day === sel.day &&
        Math.abs(poiData.lat - sel.lat) < 0.000001 &&
        Math.abs(poiData.lng - sel.lng) < 0.000001;
      if (isMatch) {
        (marker as any).setStyle?.({ radius: 18, color: "white", weight: 4, fillOpacity: 1 });
      } else {
        (marker as any).setStyle?.({ radius: 8, color: "white", weight: 2, fillOpacity: 1 });
      }
      const el = marker.getElement();
      if (el) {
        (el as HTMLElement).style.transform = "";
        (el as HTMLElement).style.boxShadow = "";
      }
    }
  }, [options.selectedPOI, options.data]);

  return { markersRef };
}
