"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { ValidatedRow, Location, DayRoute } from "@/types";
import { getRouteColor } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────

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
}

interface MapViewProps {
  data: MapViewData;
  /** When true, clicking the map sets home coordinates */
  placementMode?: "home" | null;
  /** Called when user clicks to place home */
  onPlaceHome?: (lat: number, lng: number) => void;
  /** Called when user drags home marker */
  onDragHome?: (lat: number, lng: number) => void;
  /** Called when user clicks a route stop (POI) in a route */
  onPOIClick?: (lat: number, lng: number, day: number, name: string) => void;
  /** Day to highlight (dim others) */
  highlightDay?: number | null;
}

// ─── OSM Style (guarantees road network visibility) ──────────

const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: "OSM Roads",
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "osm-base",
      type: "raster",
      source: "osm",
    },
  ],
};

// ─── Component ───────────────────────────────────────────────

export default function MapView({
  data,
  placementMode,
  onPlaceHome,
  onDragHome,
  onPOIClick,
  highlightDay,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const homeMarkerRef = useRef<maplibregl.Marker | null>(null);
  const routeLayersRef = useRef<string[]>([]);
  const initializedRef = useRef(false);
  const placementLabelRef = useRef<HTMLDivElement | null>(null);

  // ── Init map once ──
  useEffect(() => {
    if (containerRef.current && !initializedRef.current) {
      initializedRef.current = true;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: OSM_STYLE,
        center: [-47.5, -15.5], // default: central Brazil
        zoom: 4,
        attributionControl: false,
      });

      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.addControl(
        new maplibregl.AttributionControl({ compact: true }),
        "bottom-right"
      );

      // Click handler for placement mode
      map.on("click", (e) => {
        if (placementMode === "home" && onPlaceHome) {
          onPlaceHome(e.lngLat.lat, e.lngLat.lng);
        }
      });

      // Cursor change
      map.on("mousemove", (e) => {
        const target = e.originalEvent.target as HTMLElement;
        if (placementMode === "home") {
          target.style.cursor = "crosshair";
        } else {
          target.style.cursor = "";
        }
      });

      mapRef.current = map;
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        initializedRef.current = false;
        markersRef.current.clear();
        homeMarkerRef.current = null;
        routeLayersRef.current = [];
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update placement mode cursor ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // We need to re-attach the click handler when placementMode changes
    // since the initial one captured the initial props via closure.
    // But using refs is better, so let's store the current callbacks.
  });

  // Use refs to always have latest callbacks
  const onPlaceHomeRef = useRef(onPlaceHome);
  const onDragHomeRef = useRef(onDragHome);
  const placementModeRef = useRef(placementMode);

  useEffect(() => {
    onPlaceHomeRef.current = onPlaceHome;
    onDragHomeRef.current = onDragHome;
    placementModeRef.current = placementMode;
  }, [onPlaceHome, onDragHome, placementMode]);

  // Re-attach click handlers when placementMode changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.loaded()) return;

    // Remove old and add new click handler
    const handler = (e: maplibregl.MapMouseEvent) => {
      if (placementModeRef.current === "home" && onPlaceHomeRef.current) {
        onPlaceHomeRef.current(e.lngLat.lat, e.lngLat.lng);
      }
    };

    const cursorHandler = (e: maplibregl.MapMouseEvent) => {
      const target = e.originalEvent.target as HTMLElement;
      target.style.cursor =
        placementModeRef.current === "home" ? "crosshair" : "";
    };

    map.on("click", handler);
    map.on("mousemove", cursorHandler);

    return () => {
      map.off("click", handler);
      map.off("mousemove", cursorHandler);
    };
  }, [placementMode]);

  // ── Sync map content with data ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const { markers, locations, routes, home, hiddenDays, routeGeometry } = data;
    const markersMap = markersRef.current;

    // ── Collect all points for bounds ──
    const allPoints: [number, number][] = [];

    // ── Draw / toggle routes (results phase) ──
    if (routes) {
      for (const day of routes) {
        const color = getRouteColor(day.day - 1);

        // Build polyline coordinates — use OSRM road geometry when available
        const coords: [number, number][] = [];

        // Try day-level route geometry (full day's route in one polyline)
        const dayGeo = routeGeometry?.get(day.day);
        if (dayGeo && dayGeo.length > 1) {
          coords.push(...dayGeo);
        } else {
          // Fallback: straight lines between stops
          for (let s = 0; s < day.stops.length - 1; s++) {
            if (s === 0) coords.push([day.stops[s].lng, day.stops[s].lat]);
            coords.push([day.stops[s + 1].lng, day.stops[s + 1].lat]);
          }
        }

        allPoints.push(...coords);

        const layerId = `rl-${day.day}`;
        const sourceId = `rs-${day.day}`;
        const isHidden = hiddenDays?.has(day.day);

        // Create or update layer
        const existingSource = map.getSource(sourceId);
        const glowId = `rg-${day.day}`;
        if (!existingSource) {
          map.addSource(sourceId, {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: coords },
            },
          });
          // Glow/outline layer (dark for contrast)
          map.addLayer({
            id: glowId,
            type: "line",
            source: sourceId,
            layout: { "line-join": "round", "line-cap": "round", visibility: isHidden ? "none" : "visible" },
            paint: {
              "line-color": "#000000",
              "line-width": 6,
              "line-opacity": highlightDay && highlightDay !== day.day ? 0.08 : 0.25,
            },
          });
          // Route layer (colored, thick)
          map.addLayer({
            id: layerId,
            type: "line",
            source: sourceId,
            layout: { "line-join": "round", "line-cap": "round", visibility: isHidden ? "none" : "visible" },
            paint: {
              "line-color": color,
              "line-width": highlightDay && highlightDay !== day.day ? 3 : 5,
              "line-opacity": highlightDay && highlightDay !== day.day ? 0.3 : 1,
            },
          });
          routeLayersRef.current.push(glowId, layerId);
        } else {
          // Update source data
          try {
            (existingSource as any).setData({
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: coords },
            });
          } catch {}
          // Toggle visibility for both glow and route
          map.setLayoutProperty(layerId, "visibility", isHidden ? "none" : "visible");
          map.setLayoutProperty(glowId, "visibility", isHidden ? "none" : "visible");
        }
      }
    }

    // Hide stale route layers
    const activeDays = new Set(routes?.map((d) => d.day) ?? []);
    const layerPrefix = (id: string) => id.slice(0, 3); // "rl-" or "rg-"
    const dayNum = (id: string) => parseInt(id.slice(3), 10);

    for (const layerId of routeLayersRef.current) {
      const day = dayNum(layerId);
      if (!activeDays.has(day)) {
        try {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
        } catch {}
      } else if (routes) {
        const isHidden = hiddenDays?.has(day);
        map.setLayoutProperty(layerId, "visibility", isHidden ? "none" : "visible");
      }
    }

    // Clean up orphan sources (no layers left for that day)
    const activeSrcIds = new Set<string>();
    for (const layerId of routeLayersRef.current) {
      if (map.getLayer(layerId)) activeSrcIds.add(`rs-${dayNum(layerId)}`);
    }
    for (const srcId of routeLayersRef.current.map(l => `rs-${dayNum(l)}`)) {
      if (!activeSrcIds.has(srcId) && map.getSource(srcId)) {
        try { map.removeSource(srcId); } catch {}
      }
    }
    routeLayersRef.current = routes?.map((d) => `rl-${d.day}`) ?? [];

    // ── Add home marker (draggable) ──
    if (home && home.lat && home.lng) {
      allPoints.push([home.lng, home.lat]);

      if (!homeMarkerRef.current) {
        // Create home marker
        const el = document.createElement("div");
        el.innerHTML = `<svg width="34" height="34" viewBox="0 0 24 24" fill="#2563eb" stroke="white" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
        el.style.cursor = "grab";
        el.style.filter = "drop-shadow(0 2px 4px rgba(0,0,0,0.3))";

        const marker = new maplibregl.Marker({
          element: el,
          draggable: true,
        })
          .setLngLat([home.lng, home.lat])
          .setPopup(
            new maplibregl.Popup({ offset: 25 }).setHTML(
              `<strong>🏠 Casa</strong><br/>${home.lat.toFixed(4)}, ${home.lng.toFixed(4)}`
            )
          )
          .addTo(map);

        marker.on("dragend", () => {
          const pos = marker.getLngLat();
          if (onDragHomeRef.current) {
            onDragHomeRef.current(pos.lat, pos.lng);
          }
        });

        homeMarkerRef.current = marker;
      } else {
        // Update position
        const m = homeMarkerRef.current;
        const pos = m.getLngLat();
        if (Math.abs(pos.lat - home.lat) > 0.000001 || Math.abs(pos.lng - home.lng) > 0.000001) {
          m.setLngLat([home.lng, home.lat]);
        }
      }
    } else if (homeMarkerRef.current) {
      homeMarkerRef.current.remove();
      homeMarkerRef.current = null;
    }

    // ── Clean location markers ──
    const keepIds = new Set<string>();

    const addMarker = (
      id: string,
      lat: number,
      lng: number,
      label: string,
      color: string,
      popupHtml?: string,
      /** Show as pin icon instead of numbered circle */
      pinOnly?: boolean,
      /** Click handler (for route editing) */
      onClick?: () => void
    ) => {
      keepIds.add(id);
      const existing = markersMap.get(id);
      if (existing) {
        existing.setLngLat([lng, lat]);
        if (onClick) (existing as any)._clickFn = onClick;
        return;
      }

      const el = document.createElement("div");

      if (pinOnly) {
        // Simple POI dot
        el.className =
          "w-4 h-4 rounded-full border-2 border-white shadow-md cursor-pointer transition-transform hover:scale-125";
        el.style.backgroundColor = color;
      } else {
        // Numbered circle
        el.className =
          "flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold text-white shadow-md cursor-pointer transition-transform hover:scale-110";
        el.style.backgroundColor = color;
        el.textContent = label;
      }

      const m = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);
      if (popupHtml) {
        m.setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(popupHtml));
      }
      if (onClick) {
        el.style.cursor = "pointer";
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onClick();
        });
      }
      markersMap.set(id, m);
    };

    // ── Markers from validated rows (pin dots, no numbers) ──
    if (markers) {
      for (const row of markers) {
        if (row.lat === null || row.lng === null) continue;
        const color = row.selected ? "#3b82f6" : "#9ca3af";
        addMarker(row.id, row.lat, row.lng, "", color, undefined, true);
        const m = markersMap.get(row.id);
        if (m) {
          m.getElement().style.opacity = row.selected ? "1" : "0.4";
        }
        allPoints.push([row.lng, row.lat]);
      }
    }

    // ── Markers from confirmed locations (pin dots, no numbers) ──
    if (locations) {
      for (let i = 0; i < locations.length; i++) {
        const loc = locations[i];
        const id = `loc-${i}`;
        addMarker(
          id,
          loc.lat,
          loc.lng,
          "",
          "#3b82f6",
          `<strong>${loc.name}</strong><br/>${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`,
          true
        );
        allPoints.push([loc.lng, loc.lat]);
      }
    }

    // ── Route stop markers ──
    if (routes) {
      for (const day of routes) {
        const isHidden = hiddenDays?.has(day.day);
        for (const stop of day.stops) {
          if (stop.isHome) continue;
          const id = `rs-${day.day}-${stop.sequence}`;
          const color = getRouteColor(day.day - 1);

          if (isHidden) {
            // Remove marker if day is hidden
            const existing = markersMap.get(id);
            if (existing) {
              existing.remove();
              markersMap.delete(id);
            }
            continue;
          }

          addMarker(
            id,
            stop.lat,
            stop.lng,
            String(stop.sequence),
            color,
            `<strong>${stop.name}</strong><br/>Día ${day.day} · #${stop.sequence}<br/>${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}`,
            false,
            () => onPOIClick?.(stop.lat, stop.lng, day.day, stop.name)
          );
        }
      }
    }

    // ── Remove stale markers ──
    for (const [id, marker] of markersMap) {
      if (!keepIds.has(id)) {
        marker.remove();
        markersMap.delete(id);
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
          padding: { top: 100, bottom: 80, left: 80, right: 80 },
          maxZoom: 16,
          duration: 400,
        });
      } catch {}
    }
  }, [data]);

  return (
    <div className="absolute inset-0" style={{ width: "100%", height: "100%" }}>
      {/* Routing mode badge (bottom-left of map) */}
      {data.routingMode && (
        <div className="absolute bottom-4 left-4 z-10 px-2.5 py-1 bg-white/90 backdrop-blur-sm rounded-full shadow text-xs text-gray-500 border">
          {data.routingMode === "osrm" ? "🚗 Ruta real" : "📏 Línea recta"}
        </div>
      )}

      {/* Placement mode overlay indicator */}
      {placementMode === "home" && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 bg-blue-600 text-white rounded-full shadow-lg text-sm font-medium whitespace-nowrap">
          🏠 Haz clic en el mapa para colocar la casa
        </div>
      )}

      {/* Map container */}
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
