"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { Car, Ruler, MapPin } from "lucide-react";
import { ValidatedRow, Location, DayRoute } from "@/types";
import { getRouteColor } from "@/lib/utils";
import type { RouteSource } from "@/utils/clientRouting";

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

// ─── OSM Style (guarantees road network visibility) ──────────

// Dash patterns for estimated (Haversine) routes — applied to both the
// route layer and the glow layer so the dashing is consistent. Glow uses
// a sparser pattern so the gap regions still show a faint halo outline.
const ROUTE_DASH: [number, number] = [2, 3];
const GLOW_DASH: [number, number] = [1, 4];

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
  homeDraggable,
  onPOIClick,
  highlightDay,
  selectedPOI,
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
  const onPOIClickRef = useRef(onPOIClick);

  useEffect(() => {
    onPlaceHomeRef.current = onPlaceHome;
    onDragHomeRef.current = onDragHome;
    placementModeRef.current = placementMode;
    onPOIClickRef.current = onPOIClick;
  }, [onPlaceHome, onDragHome, placementMode, onPOIClick]);

  // ── Update home marker draggability ──
  useEffect(() => {
    if (homeMarkerRef.current) {
      homeMarkerRef.current.setDraggable(!!homeDraggable);
    }
  }, [homeDraggable]);

  // Re-attach click handlers when placementMode changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.loaded()) return;

    // Remove old and add new click handler
    const handler = (e: maplibregl.MapMouseEvent) => {
      // Check if click was on a marker container (for POI selection).
      // Markers bubble clicks up to the map, so we can catch them here.
      const target = e.originalEvent.target as HTMLElement | null;
      if (target) {
        const markerContainer = target.closest(".maplibregl-marker");
        if (markerContainer) {
          const poiData = (markerContainer as any)._poiData as
            | { lat: number; lng: number; day: number; name: string }
            | undefined;
          if (poiData && onPOIClickRef.current) {
            onPOIClickRef.current(poiData.lat, poiData.lng, poiData.day, poiData.name);
          }
          return; // Don't also trigger placement mode
        }
      }
      // Placement mode (home)
      if (placementModeRef.current === "home" && onPlaceHomeRef.current) {
        onPlaceHomeRef.current(e.lngLat.lat, e.lngLat.lng);
      }
    };

    const cursorHandler = (e: maplibregl.MapMouseEvent) => {
      const target = e.originalEvent.target as HTMLElement;
      // Pointer cursor on markers
      if (target?.closest?.(".maplibregl-marker")) {
        target.style.cursor = "pointer";
      } else {
        target.style.cursor =
          placementModeRef.current === "home" ? "crosshair" : "";
      }
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

    const { markers, locations, routes, home, hiddenDays, routeGeometry, routeSource } = data;
    const markersMap = markersRef.current;

    // ── Collect all points for bounds ──
    const allPoints: [number, number][] = [];

    // ── Draw / toggle routes (results phase) ──
    if (routes) {
      for (const day of routes) {
        const color = getRouteColor(day.day - 1);

        // Build polyline coordinates — use OSRM road geometry when available
        const coords: [number, number][] = [];
        const hasOnlyHome = day.stops.every((s) => s.isHome);

        let usedRealGeometry = false;
        if (!hasOnlyHome) {
          // Try day-level route geometry (full day's route in one polyline)
          const dayGeo = routeGeometry?.get(day.day);
          if (dayGeo && dayGeo.length > 1) {
            // OSRM already routes through ALL waypoints (home → POIs → home).
            // The first/last coords may be snapped to the nearest road, but
            // the entire journey is road-following — use as-is.
            coords.push(...dayGeo);
            usedRealGeometry = true;
          } else {
            // Fallback: straight lines between ALL consecutive stops (home → POIs → home)
            for (let s = 0; s < day.stops.length - 1; s++) {
              coords.push([day.stops[s].lng, day.stops[s].lat]);
            }
            coords.push([day.stops[day.stops.length - 1].lng, day.stops[day.stops.length - 1].lat]);
          }
        }

        allPoints.push(...coords);

        const layerId = `rl-${day.day}`;
        const sourceId = `rs-${day.day}`;
        const isHidden = hiddenDays?.has(day.day);

        // ── Decide dash style ──
        // A day is "estimated" (use dashed line) when:
        //   - the geometry is the straight-line fallback (no routeGeometry), OR
        //   - the source is "haversine", OR
        //   - the source is unknown (conservative — render as estimated).
        // Real-road routes ("osrm" / "geoapify") render as solid lines.
        const daySource = usedRealGeometry ? routeSource?.get(day.day) : "haversine";
        const isEstimated = !usedRealGeometry || daySource === "haversine" || daySource === undefined;

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
              "line-width": highlightDay && highlightDay === day.day ? 8 : 6,
              "line-opacity": highlightDay && highlightDay !== day.day ? 0.04 : 0.25,
              // Glow uses a sparser dash so gaps in the route still show a halo
              ...(isEstimated ? { "line-dasharray": GLOW_DASH } : {}),
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
              "line-width": highlightDay && highlightDay === day.day ? 6 : highlightDay ? 2 : 4,
              "line-opacity": highlightDay && highlightDay !== day.day ? 0.1 : 1,
              // Subtle dashes for estimated routes — visible but not distracting
              ...(isEstimated ? { "line-dasharray": ROUTE_DASH } : {}),
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
          // Keep the dash style in sync with the current source — covers
          // re-optimization cases where a day switches between real/estimated
          if (map.getLayer(layerId)) {
            map.setPaintProperty(layerId, "line-dasharray", isEstimated ? ROUTE_DASH : undefined as any);
          }
          if (map.getLayer(glowId)) {
            map.setPaintProperty(glowId, "line-dasharray", isEstimated ? GLOW_DASH : undefined as any);
          }
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
        el.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="#2563eb" fill-opacity="0.7" stroke="white" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
        el.style.cursor = homeDraggable ? "grab" : "default";
        el.style.filter = "drop-shadow(0 1px 2px rgba(0,0,0,0.25))";

        const marker = new maplibregl.Marker({
          element: el,
          draggable: true,
        })
          .setLngLat([home.lng, home.lat])
          .setPopup(
            new maplibregl.Popup({ offset: 25 }).setHTML(
              `<strong>Casa</strong><br/>${home.lat.toFixed(4)}, ${home.lng.toFixed(4)}`
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
      onClick?: () => void,
      /** Optional POI metadata — stored on the element for highlight + click. */
      poiData?: { lat: number; lng: number; day: number; name: string }
    ) => {
      keepIds.add(id);
      const existing = markersMap.get(id);
      if (existing) {
        existing.setLngLat([lng, lat]);
        if (poiData) (existing.getElement() as any)._poiData = poiData;
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

      if (poiData) {
        (el as any)._poiData = poiData;
        // Also store on the marker container for the highlight effect
        // (marker.getElement() returns the container, not el)
      }

      const m = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);
      if (popupHtml) {
        m.setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(popupHtml));
      }
      // Click handler on the marker's ROOT container using CAPTURE phase.
      // This fires BEFORE MapLibre's popup toggle (which calls stopPropagation
      // in the bubble phase, preventing the event from reaching the map).
      if (poiData) {
        const container = m.getElement();
        (container as any)._poiData = poiData;
        container.addEventListener("click", () => {
          if (onPOIClickRef.current) {
            onPOIClickRef.current(poiData.lat, poiData.lng, poiData.day, poiData.name);
          }
        }, { capture: true });
      }
      markersMap.set(id, m);
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
            () => onPOIClickRef.current?.(stop.lat, stop.lng, day.day, stop.name),
            { lat: stop.lat, lng: stop.lng, day: day.day, name: stop.name }
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

  // ── Update route paint properties when highlightDay changes ──
  // Visibility is handled by the main [data] effect via hiddenDays.
  // This effect only updates line width/opacity for existing route layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data.routes) return;
    for (const day of data.routes) {
      const layerId = `rl-${day.day}`;
      const glowId = `rg-${day.day}`;
      if (!map.getLayer(layerId) || !map.getLayer(glowId)) continue;

      const isHighlighted = highlightDay === day.day;
      // Update route layer paint
      map.setPaintProperty(layerId, "line-width", isHighlighted ? 6 : highlightDay ? 2 : 4);
      map.setPaintProperty(layerId, "line-opacity", isHighlighted ? 1 : highlightDay ? 0.1 : 1);
      // Update glow layer paint
      map.setPaintProperty(glowId, "line-width", isHighlighted ? 8 : 6);
      map.setPaintProperty(glowId, "line-opacity", isHighlighted ? 0.3 : 0.25);
    }
  }, [highlightDay, data]);

  // ── Highlight the selected POI marker (scale-up + ring) ──
  useEffect(() => {
    // Find the matching marker by matching its stored data on the
    // element. Markers created by addMarker with onClick have lat/lng
    // stored on the element via a data attribute (see addMarker below).
    for (const [id, marker] of markersRef.current) {
      const el = marker.getElement() as HTMLElement & {
        _poiData?: { lat: number; lng: number; day: number };
      };
      const isMatch =
        selectedPOI !== null &&
        selectedPOI !== undefined &&
        el._poiData !== undefined &&
        el._poiData.day === selectedPOI.day &&
        Math.abs(el._poiData.lat - selectedPOI.lat) < 0.000001 &&
        Math.abs(el._poiData.lng - selectedPOI.lng) < 0.000001;

      if (isMatch) {
        el.style.transform = "scale(1.4)";
        el.style.boxShadow =
          "0 0 0 4px rgba(59, 130, 246, 0.6), 0 0 0 6px rgba(59, 130, 246, 0.3)";
        el.style.zIndex = "20";
      } else {
        el.style.transform = "";
        el.style.boxShadow = "";
        el.style.zIndex = "";
      }
      void id;
    }
  }, [selectedPOI, data]);

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
            <>
              <Ruler className="w-3.5 h-3.5" />
              Línea recta
            </>
          )}
        </div>
      )}

      {/* Placement mode overlay indicator */}
      {placementMode === "home" && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 bg-blue-600 text-white rounded-full shadow-lg text-sm font-medium whitespace-nowrap flex items-center gap-2">
          <MapPin className="w-4 h-4" />
          Haz clic en el mapa para colocar la casa
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
