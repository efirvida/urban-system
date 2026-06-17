"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";

interface PolylineOptions {
  routes?: Array<{
    day: number;
    stops: Array<{ lat: number; lng: number; isHome?: boolean }>;
  }>;
  routeGeometry?: Map<number, [number, number][]>;
  hiddenDays?: Set<number>;
  highlightDay?: number | null;
}

export function useLeafletPolylines(
  mapRef: React.RefObject<L.Map | null>,
  options: PolylineOptions
) {
  const groupsRef = useRef<Map<number, L.LayerGroup>>(new Map());

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !options.routes) return;

    const groups = groupsRef.current;
    const activeDays = new Set(options.routes.map((d) => d.day));

    // Remove orphan groups
    for (const [day, group] of groups) {
      if (!activeDays.has(day)) {
        group.remove();
        groups.delete(day);
      }
    }

    for (const day of options.routes) {
      const color = getColor(day.day - 1);
      const isHidden = options.hiddenDays?.has(day.day);
      const isHighlighted = options.highlightDay === day.day;
      const isDimmed = options.highlightDay !== null && !isHighlighted;

      // Build coordinates
      const coords: [number, number][] = [];
      const dayGeo = options.routeGeometry?.get(day.day);

      if (dayGeo && dayGeo.length > 1) {
        coords.push(...dayGeo.map((c) => [c[1], c[0]] as [number, number]));
      } else {
        // Fallback: straight lines
        const stops = day.stops;
        for (let s = 0; s < stops.length; s++) {
          coords.push([stops[s].lat, stops[s].lng]);
        }
      }

      if (coords.length < 2) continue;

      let group = groups.get(day.day);
      if (!group) {
        group = L.layerGroup().addTo(map);
        groups.set(day.day, group);
      }

      // Clear and rebuild polylines in this group
      group.clearLayers();

      // Glow polyline (wider, darker, lower opacity)
      const glow = L.polyline(coords, {
        color: "#000000",
        weight: isHighlighted ? 8 : isDimmed ? 6 : 6,
        opacity: isHighlighted ? 0.3 : isDimmed ? 0.04 : 0.25,
        lineCap: "round",
        lineJoin: "round",
      });
      group.addLayer(glow);

      // Route polyline (colored)
      const route = L.polyline(coords, {
        color,
        weight: isHighlighted ? 6 : isDimmed ? 2 : 4,
        opacity: isHighlighted ? 1 : isDimmed ? 0.1 : 1,
        lineCap: "round",
        lineJoin: "round",
      });
      group.addLayer(route);

      // Toggle visibility
      if (isHidden) {
        map.removeLayer(group);
      } else if (!map.hasLayer(group)) {
        group.addTo(map);
      }
    }
  }, [mapRef, options]); // eslint-disable-line react-hooks/exhaustive-deps

  return { groupsRef };
}

const ROUTE_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899",
  "#06b6d4", "#f97316", "#14b8a6", "#6366f1", "#84cc16", "#d946ef",
];

function getColor(index: number): string {
  return ROUTE_COLORS[index % ROUTE_COLORS.length];
}
