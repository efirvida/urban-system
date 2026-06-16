"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { DayRoute, Config } from "@/types";
import { getRouteColor } from "@/lib/utils";

interface RouteMapProps {
  days: DayRoute[];
  config: Config;
}

export default function RouteMap({ days, config }: RouteMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (mapContainerRef.current && !initializedRef.current) {
      initializedRef.current = true;

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        // Free demo tile style from OpenFreeMap
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: [config.homeLng, config.homeLat],
        zoom: 10,
        attributionControl: false,
      });

      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.addControl(new maplibregl.AttributionControl({ compact: true }));

      map.on("load", () => {
        // Add home marker
        const homeEl = document.createElement("div");
        homeEl.innerHTML =
          '<svg width="32" height="32" viewBox="0 0 24 24" fill="#2563eb" stroke="white" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
        homeEl.style.cursor = "pointer";

        const homePopup = new maplibregl.Popup({ offset: 25 }).setHTML(
          `<strong>🏠 Casa</strong><br/>${config.homeLat.toFixed(
            4
          )}, ${config.homeLng.toFixed(4)}`
        );

        new maplibregl.Marker({ element: homeEl })
          .setLngLat([config.homeLng, config.homeLat])
          .setPopup(homePopup)
          .addTo(map);

        // Collect all coordinates for bounds calculation
        const allCoords: [number, number][] = [
          [config.homeLng, config.homeLat],
        ];

        // Add day routes
        days.forEach((day) => {
          const color = getRouteColor(day.day - 1);
          const coordinates: [number, number][] = day.stops.map((s) => [
            s.lng,
            s.lat,
          ]);
          allCoords.push(...coordinates);

          // Polyline
          const routeId = `route-${day.day}`;
          const sourceId = `source-${day.day}`;

          map.addSource(sourceId, {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates,
              },
            },
          });

          map.addLayer({
            id: routeId,
            type: "line",
            source: sourceId,
            layout: {
              "line-join": "round",
              "line-cap": "round",
            },
            paint: {
              "line-color": color,
              "line-width": 3,
              "line-opacity": 0.8,
            },
          });

          // Add location markers (skip home which we already added)
          const visitStops = day.stops.filter((s) => !s.isHome);
          visitStops.forEach((stop, idx) => {
            const markerEl = document.createElement("div");
            markerEl.className =
              "flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold text-white shadow-md";
            markerEl.style.backgroundColor = color;
            markerEl.textContent = `${day.stops.indexOf(stop)}`;

            const popupHtml = `
              <strong>${stop.name}</strong><br/>
              <span class="text-gray-500">Día ${day.day} · Parada #${stop.sequence}</span><br/>
              <span class="text-xs text-gray-400">${stop.lat.toFixed(
                4
              )}, ${stop.lng.toFixed(4)}</span>
            `;

            const popup = new maplibregl.Popup({ offset: 25 }).setHTML(
              popupHtml
            );

            new maplibregl.Marker({ element: markerEl })
              .setLngLat([stop.lng, stop.lat])
              .setPopup(popup)
              .addTo(map);
          });
        });

        // Fit bounds to show everything
        if (allCoords.length > 1) {
          const bounds = allCoords.reduce(
            (bounds, coord) => bounds.extend(coord as [number, number]),
            new maplibregl.LngLatBounds(
              allCoords[0],
              allCoords[0]
            )
          );

          map.fitBounds(bounds, {
            padding: { top: 60, bottom: 60, left: 60, right: 60 },
            maxZoom: 16,
          });
        }
      });

      mapRef.current = map;
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        initializedRef.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={mapContainerRef}
      className="map-container"
      style={{ width: "100%", height: "100%", minHeight: "500px" }}
    />
  );
}
