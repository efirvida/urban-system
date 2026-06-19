"use client";

import { useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import type { RouteSource } from "@/utils/clientRouting";

const ROUTE_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899",
  "#06b6d4", "#f97316", "#14b8a6", "#6366f1", "#84cc16", "#d946ef",
];

function getColor(index: number): string {
  return ROUTE_COLORS[index % ROUTE_COLORS.length];
}

interface UseLeafletRoutesOptions {
  routes?: Array<{
    day: number;
    stops: Array<{ lat: number; lng: number; isHome?: boolean; sequence: number; name: string }>;
  }>;
  routeGeometry?: Map<number, [number, number][]>;
  routeSource?: Map<number, RouteSource>;
  hiddenDays?: Set<number>;
  highlightDay?: number | null;
  onPOIClick?: (lat: number, lng: number, day: number, name: string) => void;
  selectedPOI?: { lat: number; lng: number; day: number; name: string } | null;
}

export function useLeafletRoutes(
  mapRef: React.RefObject<L.Map | null>,
  options: UseLeafletRoutesOptions
) {
  const groupsRef = useRef<Map<number, L.LayerGroup>>(new Map());
  const onPOIClickRef = useRef(options.onPOIClick);
  const poiDataRef = useRef(new Map<string, { lat: number; lng: number; day: number; name: string }>());
  const dataKeyRef = useRef("");

  useEffect(() => {
    onPOIClickRef.current = options.onPOIClick;
  }, [options.onPOIClick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !options.routes) return;

    const groups = groupsRef.current;
    const activeDays = new Set(options.routes.map((d) => d.day));
    const poiData = poiDataRef.current;
    poiData.clear();

    // Remove orphan groups
    for (const [day, group] of groups) {
      if (!activeDays.has(day)) {
        group.remove();
        groups.delete(day);
      }
    }

    for (const day of options.routes) {
      try {
      const color = getColor(day.day - 1);
      const isHidden = options.hiddenDays?.has(day.day);
      const isHighlighted = options.highlightDay === day.day;
      const isDimmed = options.highlightDay !== null && options.highlightDay !== undefined && !isHighlighted;

      // Build polyline coords — prefer real road geometry when available
      const coords: [number, number][] = [];
      let usedRoadGeo = false;
      const dayGeo = options.routeGeometry?.get(day.day);
      if (dayGeo && dayGeo.length > 1) {
        const mapped = dayGeo.map((c) => [c[1], c[0]] as [number, number]);
        if (mapped.every((c) => isFinite(c[0]) && isFinite(c[1])) && mapped.length > 1) {
          coords.push(...mapped);
          usedRoadGeo = true;
        }
      }
      // Fallback: use stops (guaranteed valid)
      if (!usedRoadGeo) {
        for (const s of day.stops) {
          coords.push([s.lat, s.lng]);
        }
      }

      const hasCoords = coords.length >= 2;

      // Dash style: real roads (coords from routeGeometry with osrm/geoapify source) → solid.
      // Stops fallback or unknown source → dashed (estimated).
      const daySource = options.routeSource?.get(day.day);
      const isEstimated = !usedRoadGeo || daySource === "haversine" || daySource === undefined;
      const dash = isEstimated ? ([2, 3] as number[]) : undefined;
      const glowDash = isEstimated ? ([1, 4] as number[]) : undefined;

      // Get or create layer group
      let group = groups.get(day.day);
      if (!group) {
        group = L.layerGroup().addTo(map);
        groups.set(day.day, group);
      }
      group.clearLayers();

      // ── Polylines ──
      if (hasCoords) {
        // Glow
        const glow = L.polyline(coords, {
          color: "#000000",
          weight: isHighlighted ? 8 : 6,
          opacity: isHidden ? 0 : isHighlighted ? 0.3 : 0.25,
          lineCap: "round",
          lineJoin: "round",
          dashArray: glowDash,
        });
        group.addLayer(glow);

        // Route
        const route = L.polyline(coords, {
          color,
          weight: isHighlighted ? 6 : isDimmed ? 2 : 4,
          opacity: isHidden ? 0 : isHighlighted ? 1 : isDimmed ? 0.1 : 1,
          lineCap: "round",
          lineJoin: "round",
          dashArray: dash,
        });
        group.addLayer(route);
      }

      // ── Stop markers ──
      for (const stop of day.stops) {
        if (stop.isHome) continue;
        const stopId = `rs-${day.day}-${stop.sequence}`;
        const isSmall = isHidden || isDimmed;
        const radius = isSmall ? (isHidden ? 8 : 6) : 14;
        const fillOpacity = isSmall ? (isHidden ? 0.5 : 0.2) : 1;

        const circle = L.circleMarker([stop.lat, stop.lng], {
          radius,
          color: "white",
          weight: isSmall ? 2 : 3,
          fillColor: color,
          fillOpacity,
        }).addTo(group);

        if (!isSmall) {
          circle.bindTooltip(String(stop.sequence), {
            permanent: true,
            direction: "center",
            className: "route-stop-label",
          });
        }

        circle.bindPopup(
          `<strong>${stop.name}</strong><br/>Día ${day.day} · #${stop.sequence}<br/>${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}`
        );

        const pd = { lat: stop.lat, lng: stop.lng, day: day.day, name: stop.name };
        (circle as any)._poiData = pd;
        poiData.set(stopId, pd);

        circle.on("click", () => {
          if (onPOIClickRef.current) {
            onPOIClickRef.current(stop.lat, stop.lng, day.day, stop.name);
          }
        });
      }

      // Keep group on map always — hidden days already have invisible
      // polylines (opacity 0) and small dimmed stop markers (radius 8, opacity 0.5).
      // Previously we removed the group entirely, but that also hid the stop markers
      // that users rely on to see where POIs are located.
      if (!map.hasLayer(group)) {
        group.addTo(map);
      }
      } catch (e) {
        console.warn(`[Routes] Day ${day.day} skipped:`, e);
      }
    }

    // Fit map to all route coordinates — solo si los datos espaciales cambiaron
    const spatialKey = JSON.stringify(options.routes.map(d => `${d.day}:${d.stops.length}`).join(","));
    const dataChanged = spatialKey !== dataKeyRef.current;
    if (dataChanged) {
      dataKeyRef.current = spatialKey;
      const allCoords: [number, number][] = [];
      for (const day of options.routes) {
        const dayGeo = options.routeGeometry?.get(day.day);
        if (dayGeo && dayGeo.length > 1) {
          allCoords.push(...dayGeo.map((c) => [c[1], c[0]] as [number, number]));
        } else {
          for (const s of day.stops) {
            if (!s.isHome) allCoords.push([s.lat, s.lng]);
          }
        }
      }
      if (allCoords.length > 0) {
        try {
          const bounds = L.latLngBounds(allCoords);
          map.fitBounds(bounds, { padding: [80, 80], maxZoom: 16 });
        } catch {}
      }
    }
  }, [mapRef, options]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selected POI highlight — walk ALL layers in all groups looking for _poiData match
  useEffect(() => {
    const sel = options.selectedPOI;
    const groups = groupsRef.current;

    for (const [, group] of groups) {
      group.eachLayer((layer) => {
        const poiData = (layer as any)._poiData as { lat: number; lng: number; day: number } | undefined;
        if (!poiData) return;
        const isMatch = sel &&
          poiData.day === sel.day &&
          Math.abs(poiData.lat - sel.lat) < 0.000001 &&
          Math.abs(poiData.lng - sel.lng) < 0.000001;

        if (isMatch) {
          (layer as L.CircleMarker).setStyle?.({ radius: 18, color: "white", weight: 4, fillOpacity: 1 });
        } else {
          // Restore: check if this stop belongs to a hidden/dimmed day
          const parentDay = options.routes?.find(d => d.day === poiData.day);
          if (!parentDay) return;
          const isHidden = options.hiddenDays?.has(poiData.day);
          const isDimmed = options.highlightDay !== null && options.highlightDay !== undefined && !isHidden && options.highlightDay !== poiData.day;
          const isSmall = isHidden || isDimmed;
          (layer as L.CircleMarker).setStyle?.({
            radius: isSmall ? (isHidden ? 8 : 6) : 14,
            weight: isSmall ? 2 : 3,
            fillOpacity: isSmall ? (isHidden ? 0.5 : 0.2) : 1,
          });
        }
      });
    }
  }, [options.selectedPOI, options.highlightDay, options.routes, options.hiddenDays]); // eslint-disable-line react-hooks/exhaustive-deps

  return { groupsRef };
}
