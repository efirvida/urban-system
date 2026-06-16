"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { ValidatedRow } from "@/types";

/**
 * Standalone map component with draggable markers.
 *
 * IMPORTANT: defined at module level, NOT inside another component,
 * so React doesn't remount it on every parent render.
 */
interface LocationMapEditorProps {
  rows: ValidatedRow[];
  onMarkerDrag: (id: string, lat: number, lng: number) => void;
}

export default function LocationMapEditor({
  rows,
  onMarkerDrag,
}: LocationMapEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const boundsFittedRef = useRef(false);
  const onDragRef = useRef(onMarkerDrag);

  // Keep the ref updated without triggering re-renders
  useEffect(() => {
    onDragRef.current = onMarkerDrag;
  }, [onMarkerDrag]);

  // ── Init map once ──
  useEffect(() => {
    if (containerRef.current && !mapRef.current) {
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: [0, 0],
        zoom: 2,
        attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.addControl(new maplibregl.AttributionControl({ compact: true }));

      map.on("load", () => {
        boundsFittedRef.current = false;
      });

      mapRef.current = map;
    }

    return () => {
      if (mapRef.current) {
        // Clean up all markers
        for (const [, marker] of markersRef.current) {
          marker.remove();
        }
        markersRef.current.clear();
        mapRef.current.remove();
        mapRef.current = null;
        boundsFittedRef.current = false;
      }
    };
  }, []);

  // ── Sync markers with rows ──
  // This runs after every render BUT skips bounds fitting unless
  // the number of valid rows has changed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const markers = markersRef.current;
    const activeIds = new Set<string>();
    const validRows = rows.filter((r) => r.lat !== null && r.lng !== null);

    // Create or update markers
    let markerIndex = 0;
    for (const row of validRows) {
      activeIds.add(row.id);
      const existing = markers.get(row.id);

      if (existing) {
        // Update position if different (ignore floating point noise)
        const pos = existing.getLngLat();
        const dLat = Math.abs(pos.lat - row.lat!);
        const dLng = Math.abs(pos.lng - row.lng!);
        if (dLat > 0.000001 || dLng > 0.000001) {
          existing.setLngLat([row.lng!, row.lat!]);
        }

        // Update draggability
        const canDrag = row.selected && row.isValid;
        if (existing.isDraggable() !== canDrag) {
          existing.setDraggable(canDrag);
        }
      } else {
        // Create new draggable marker
        const markerEl = createMarkerEl(row, markerIndex + 1);
        const marker = new maplibregl.Marker({
          element: markerEl,
          draggable: row.selected && row.isValid,
        })
          .setLngLat([row.lng!, row.lat!])
          .addTo(map);

        marker.on("dragend", () => {
          const pos = marker.getLngLat();
          onDragRef.current(row.id, pos.lat, pos.lng);
        });

        markers.set(row.id, marker);
      }
      markerIndex++;
    }

    // Remove stale markers
    for (const [id, marker] of markers) {
      if (!activeIds.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }

    // Update visual state of all markers without recreating them
    for (const row of rows) {
      const marker = markers.get(row.id);
      if (marker) {
        const el = marker.getElement();
        el.style.backgroundColor = row.selected ? "#3b82f6" : "#9ca3af";
        el.style.opacity = row.selected ? "1" : "0.4";
      }
    }
  }, [rows]);

  // ── Fit bounds only when valid-rows count changes ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.loaded()) return;

    const validSelected = rows.filter(
      (r) => r.selected && r.lat !== null && r.lng !== null
    );

    if (validSelected.length === 0) return;

    const coords: [number, number][] = validSelected.map((r) => [r.lng!, r.lat!]);
    const bounds = coords.reduce(
      (b, c) => b.extend(c),
      new maplibregl.LngLatBounds(coords[0], coords[0])
    );

    map.fitBounds(bounds, {
      padding: { top: 50, bottom: 50, left: 50, right: 50 },
      maxZoom: 16,
      duration: 400,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.filter((r) => r.selected && r.lat !== null).length]);

  return (
    <div
      ref={containerRef}
      className="map-container"
      style={{ width: "100%", height: "100%", minHeight: "500px" }}
    />
  );
}

// ─── Marker element factory ──────────────────────────────────

function createMarkerEl(row: ValidatedRow, index: number): HTMLDivElement {
  const el = document.createElement("div");
  el.className =
    "flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold text-white shadow-md cursor-grab active:cursor-grabbing select-none";
  el.style.backgroundColor = row.selected ? "#3b82f6" : "#9ca3af";
  el.style.opacity = row.selected ? "1" : "0.4";
  el.textContent = String(index + 1);
  return el;
}
