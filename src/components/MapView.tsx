"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { ValidatedRow, Location, DayRoute, Config } from "@/types";
import { getRouteColor } from "@/lib/utils";

/**
 * Persistent full-screen map.
 * Accepts different data shapes depending on the current phase.
 */
export interface MapViewData {
  /** Markers from validated rows (edit phase) */
  markers?: ValidatedRow[];
  /** Confirmed locations (config phase) */
  locations?: Location[];
  /** Optimized routes (results phase) */
  routes?: DayRoute[];
  /** Home coordinates (config/results phase) */
  home?: { lat: number; lng: number };
}

interface MapViewProps {
  data: MapViewData;
}

export default function MapView({ data }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const routeLayersRef = useRef<string[]>([]);
  const initializedRef = useRef(false);

  // ── Init map once ──
  useEffect(() => {
    if (containerRef.current && !initializedRef.current) {
      initializedRef.current = true;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: [0, 0],
        zoom: 2,
        attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.addControl(new maplibregl.AttributionControl({ compact: true }));
      mapRef.current = map;
    }
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        initializedRef.current = false;
        markersRef.current.clear();
        routeLayersRef.current = [];
      }
    };
  }, []);

  // ── Sync map content with data ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const { markers, locations, routes, home } = data;

    // ── Collect all points for bounds ──
    const allPoints: [number, number][] = [];

    if (home) allPoints.push([home.lng, home.lat]);

    // ── Clear previous route layers ──
    for (const layerId of routeLayersRef.current) {
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        const sourceId = `source-${layerId}`;
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {}
    }
    routeLayersRef.current = [];

    // ── Draw routes (results phase) ──
    if (routes) {
      for (const day of routes) {
        const color = getRouteColor(day.day - 1);
        const coords: [number, number][] = day.stops.map((s) => [s.lng, s.lat]);
        allPoints.push(...coords);

        const layerId = `route-line-${day.day}`;
        const sourceId = `route-src-${day.day}`;

        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: coords },
            },
          });
          map.addLayer({
            id: layerId,
            type: "line",
            source: sourceId,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": color,
              "line-width": 4,
              "line-opacity": 0.85,
            },
          });
          routeLayersRef.current.push(layerId);
        }
      }
    }

    // ── Clean markers from previous render ──
    const oldMarkers = markersRef.current;
    const keepIds = new Set<string>();

    // Helper to add a marker
    const addMarker = (
      id: string,
      lat: number,
      lng: number,
      label: string,
      color: string,
      popupHtml?: string
    ) => {
      keepIds.add(id);
      const existing = oldMarkers.get(id);
      if (existing) {
        existing.setLngLat([lng, lat]);
        return;
      }
      const el = document.createElement("div");
      el.className =
        "flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold text-white shadow-md";
      el.style.backgroundColor = color;
      el.textContent = label;

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);
      if (popupHtml) {
        marker.setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(popupHtml));
      }
      oldMarkers.set(id, marker);
    };

    // ── Add home marker ──
    if (home) {
      addMarker(
        "home",
        home.lat,
        home.lng,
        "🏠",
        "#2563eb",
        `<strong>🏠 Casa</strong><br/>${home.lat.toFixed(4)}, ${home.lng.toFixed(4)}`
      );
      // Make the home marker stand out with a different size
      const m = oldMarkers.get("home");
      if (m) {
        const el = m.getElement();
        el.style.width = "32px";
        el.style.height = "32px";
        el.style.fontSize = "16px";
        el.style.border = "3px solid white";
        el.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";
      }
    }

    // ── Add location markers from validated rows ──
    if (markers) {
      for (const row of markers) {
        if (row.lat === null || row.lng === null) continue;
        const color = row.selected ? "#3b82f6" : "#9ca3af";
        const opacity = row.selected ? 1 : 0.4;
        const label = String(
          markers.filter((r) => r.lat !== null).indexOf(row) + 1
        );
        addMarker(row.id, row.lat, row.lng, label, color);
        const m = oldMarkers.get(row.id);
        if (m) {
          m.getElement().style.opacity = String(opacity);
        }
        if (row.lat !== null && row.lng !== null) {
          allPoints.push([row.lng, row.lat]);
        }
      }
    }

    // ── Add location markers from confirmed locations ──
    if (locations) {
      for (let i = 0; i < locations.length; i++) {
        const loc = locations[i];
        const id = `loc-${i}`;
        addMarker(
          id,
          loc.lat,
          loc.lng,
          String(i + 1),
          "#3b82f6",
          `<strong>${loc.name}</strong><br/>${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`
        );
        allPoints.push([loc.lng, loc.lat]);
      }
    }

    // ── Add route markers (stop circles on routes) ──
    if (routes) {
      for (const day of routes) {
        for (const stop of day.stops) {
          if (stop.isHome) continue;
          const id = `route-stop-${day.day}-${stop.sequence}`;
          const color = getRouteColor(day.day - 1);
          addMarker(
            id,
            stop.lat,
            stop.lng,
            String(stop.sequence),
            color,
            `<strong>${stop.name}</strong><br/>Día ${day.day} · Parada #${stop.sequence}<br/>${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}`
          );
        }
      }
    }

    // ── Remove stale markers ──
    for (const [id, marker] of oldMarkers) {
      if (!keepIds.has(id)) {
        marker.remove();
        oldMarkers.delete(id);
      }
    }

    // ── Fit bounds ──
    if (allPoints.length > 0) {
      try {
        const bounds = allPoints.reduce(
          (b, c) => b.extend(c),
          new maplibregl.LngLatBounds(allPoints[0], allPoints[0])
        );
        map.fitBounds(bounds, {
          padding: { top: 80, bottom: 80, left: 80, right: 80 },
          maxZoom: 16,
          duration: 400,
        });
      } catch {}
    }
  }, [data]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ width: "100%", height: "100%" }}
    />
  );
}
