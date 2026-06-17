"use client";

import { useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface UseLeafletMapOptions {
  center?: [number, number];
  zoom?: number;
  onPlaceHome?: (lat: number, lng: number) => void;
  placementMode?: "home" | null;
}

export function useLeafletMap(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options: UseLeafletMapOptions
) {
  const mapRef = useRef<L.Map | null>(null);
  const placementRef = useRef(options.placementMode);

  useEffect(() => {
    placementRef.current = options.placementMode;
  }, [options.placementMode]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: options.center ?? [-15.5, -47.5],
      zoom: options.zoom ?? 4,
      attributionControl: false,
    });

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    L.control.attribution({ prefix: false }).addTo(map);
    L.control.zoom({ position: "topright" }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Placement mode click handler
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handler = (e: L.LeafletMouseEvent) => {
      if (placementRef.current === "home" && options.onPlaceHome) {
        options.onPlaceHome(e.latlng.lat, e.latlng.lng);
      }
    };

    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [options.onPlaceHome]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cursor changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const container = map.getContainer();
    container.style.cursor = options.placementMode === "home" ? "crosshair" : "";

    return () => {
      container.style.cursor = "";
    };
  }, [options.placementMode]);

  const fitBounds = useCallback((coords: [number, number][], padding?: number) => {
    if (!mapRef.current || coords.length === 0) return;
    const bounds = L.latLngBounds(coords.map((c) => [c[1], c[0]] as L.LatLngTuple));
    mapRef.current.fitBounds(bounds, { padding: [padding ?? 80, padding ?? 80], maxZoom: 16 });
  }, []);

  const invalidateSize = useCallback(() => {
    mapRef.current?.invalidateSize();
  }, []);

  return { mapRef, fitBounds, invalidateSize, getMap: () => mapRef.current };
}
