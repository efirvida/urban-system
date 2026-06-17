"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Stop } from "@/types";

interface RouteMapProps {
  stops: Stop[];
  color?: string;
}

export default function RouteMap({ stops, color = "#3b82f6" }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [stops[0]?.lat ?? -15.5, stops[0]?.lng ?? -47.5],
      zoom: 13,
      attributionControl: false,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    L.control.attribution({ prefix: false }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync stops → polyline + markers + fitBounds
  useEffect(() => {
    const map = mapRef.current;
    if (!map || stops.length < 2) return;

    const coords = stops.map((s) => [s.lat, s.lng] as [number, number]);
    const polyline = L.polyline(coords, { color, weight: 4, opacity: 0.8 }).addTo(map);

    // Add a marker for each stop
    stops.forEach((stop) => {
      L.marker([stop.lat, stop.lng])
        .addTo(map)
        .bindPopup(`<strong>${stop.name}</strong>`);
    });

    // Fit bounds to all stops
    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });

    return () => {
      // Clean up polyline + markers on next render
      map.eachLayer((layer) => {
        if (layer instanceof L.Polyline || layer instanceof L.Marker) {
          layer.remove();
        }
      });
    };
  }, [stops, color]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "300px", borderRadius: "8px" }}
    />
  );
}
