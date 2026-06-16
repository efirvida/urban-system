"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { ValidatedRow, Location } from "@/types";
import { cn } from "@/lib/utils";

interface DataEditorProps {
  rows: ValidatedRow[];
  onChange: (rows: ValidatedRow[]) => void;
  onConfirm: (locations: Location[]) => void;
  onBack: () => void;
}

// ─── Component ───────────────────────────────────────────────

export default function DataEditor({
  rows,
  onChange,
  onConfirm,
  onBack,
}: DataEditorProps) {
  const selectedCount = rows.filter((r) => r.selected && r.isValid).length;

  const handleToggleRow = useCallback(
    (id: string) => {
      onChange(
        rows.map((r) => (r.id === id ? { ...r, selected: !r.selected } : r))
      );
    },
    [rows, onChange]
  );

  const handleEditField = useCallback(
    (id: string, field: "name" | "lat" | "lng", value: string) => {
      onChange(
        rows.map((r) => {
          if (r.id !== id) return r;

          let newLat = r.lat;
          let newLng = r.lng;
          let newIsValid = true;
          const newErrors: string[] = [];

          if (field === "name") {
            if (!value.trim()) newErrors.push("Nombre vacío");
          } else if (field === "lat") {
            const parsed = parseFloat(value.replace(",", "."));
            if (isNaN(parsed)) {
              newErrors.push(`Latitud inválida`);
              newLat = null;
            } else if (parsed < -90 || parsed > 90) {
              newErrors.push(`Latitud fuera de rango`);
              newLat = parsed;
            } else {
              newLat = parsed;
            }
          } else if (field === "lng") {
            const parsed = parseFloat(value.replace(",", "."));
            if (isNaN(parsed)) {
              newErrors.push(`Longitud inválida`);
              newLng = null;
            } else if (parsed < -180 || parsed > 180) {
              newErrors.push(`Longitud fuera de rango`);
              newLng = parsed;
            } else {
              newLng = parsed;
            }
          }

          newIsValid = newErrors.length === 0;

          return {
            ...r,
            name: field === "name" ? value.trim() : r.name,
            lat: field === "lat" ? newLat : r.lat,
            lng: field === "lng" ? newLng : r.lng,
            rawLat: field === "lat" ? value : r.rawLat,
            rawLng: field === "lng" ? value : r.rawLng,
            isValid: newIsValid,
            validationError: newErrors.length > 0 ? newErrors.join("; ") : undefined,
            edited: true,
          };
        })
      );
    },
    [rows, onChange]
  );

  // Called by the map when a marker is dragged
  const handleMarkerDrag = useCallback(
    (id: string, lat: number, lng: number) => {
      onChange(
        rows.map((r) =>
          r.id === id
            ? {
                ...r,
                lat,
                lng,
                rawLat: String(lat),
                rawLng: String(lng),
                isValid: true,
                validationError: undefined,
                edited: true,
              }
            : r
        )
      );
    },
    [rows, onChange]
  );

  const handleConfirm = useCallback(() => {
    const locations: Location[] = rows
      .filter((r) => r.selected && r.isValid && r.lat !== null && r.lng !== null)
      .map((r) => ({
        name: r.name,
        lat: r.lat!,
        lng: r.lng!,
      }));
    onConfirm(locations);
  }, [rows, onConfirm]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">
          Revisa y ajusta las ubicaciones
        </h2>
        <span className="text-sm text-gray-500">
          {rows.length} filas &middot; {selectedCount} seleccionadas
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4" style={{ minHeight: "70vh" }}>
        {/* Left: Table */}
        <div className="lg:col-span-2 card-base overflow-hidden flex flex-col">
          <div className="card-header flex items-center justify-between">
            <span>Tabla de datos</span>
            <span className="text-xs text-gray-400">
              Arrastra los marcadores en el mapa o edita aquí
            </span>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b text-left text-gray-500 text-xs">
                  <th className="p-2 w-8"></th>
                  <th className="p-2 font-medium">Nombre</th>
                  <th className="p-2 font-medium">Latitud</th>
                  <th className="p-2 font-medium">Longitud</th>
                  <th className="p-2 w-6"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isActive = row.selected && row.isValid;
                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        "border-b last:border-0 transition-colors",
                        !row.selected && "opacity-40",
                        row.validationError && !row.selected && "",
                        "hover:bg-gray-50"
                      )}
                    >
                      {/* Checkbox */}
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={() => handleToggleRow(row.id)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>

                      {/* Name */}
                      <td className="p-2">
                        <input
                          value={row.name}
                          onChange={(e) =>
                            handleEditField(row.id, "name", e.target.value)
                          }
                          className={cn(
                            "w-full bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none px-1 py-0.5",
                            !row.name && "text-gray-300 italic"
                          )}
                          placeholder="Sin nombre"
                        />
                      </td>

                      {/* Lat */}
                      <td className="p-2">
                        <input
                          value={row.rawLat}
                          onChange={(e) =>
                            handleEditField(row.id, "lat", e.target.value)
                          }
                          className={cn(
                            "w-full bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none px-1 py-0.5 font-mono text-xs",
                            row.lat === null && "text-red-400"
                          )}
                        />
                      </td>

                      {/* Lng */}
                      <td className="p-2">
                        <input
                          value={row.rawLng}
                          onChange={(e) =>
                            handleEditField(row.id, "lng", e.target.value)
                          }
                          className={cn(
                            "w-full bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none px-1 py-0.5 font-mono text-xs",
                            row.lng === null && "text-red-400"
                          )}
                        />
                      </td>

                      {/* Status */}
                      <td className="p-2">
                        {row.validationError ? (
                          <span
                            className="text-red-500 cursor-help text-xs"
                            title={row.validationError}
                          >
                            ✗
                          </span>
                        ) : (
                          <span className="text-green-500 text-xs">✓</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Map */}
        <div className="lg:col-span-3 card-base overflow-hidden">
          <div className="card-header">Mapa interactivo — arrastra los marcadores</div>
          <LocationMap
            rows={rows}
            onMarkerDrag={handleMarkerDrag}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="btn-secondary">
          ← Volver a columnas
        </button>
        <div className="text-sm text-gray-500">
          {selectedCount} ubicación{selectedCount !== 1 ? "es" : ""} lista
          {selectedCount !== 1 ? "s" : ""} para optimizar
        </div>
        <button
          onClick={handleConfirm}
          disabled={selectedCount === 0}
          className="btn-primary"
        >
          {selectedCount > 0
            ? `Confirmar ${selectedCount} y configurar ruta →`
            : "Selecciona al menos una"}
        </button>
      </div>
    </div>
  );
}

// ─── Inner map component (isolated lifecycle) ────────────────

function LocationMap({
  rows,
  onMarkerDrag,
}: {
  rows: ValidatedRow[];
  onMarkerDrag: (id: string, lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const initializedRef = useRef(false);

  // Init map once
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
      }
    };
  }, []);

  // Sync markers with rows
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const markers = markersRef.current;
    const activeIds = new Set<string>();

    const validRows = rows.filter((r) => r.lat !== null && r.lng !== null);

    // Create or update markers
    for (const row of validRows) {
      activeIds.add(row.id);
      const existing = markers.get(row.id);

      if (existing) {
        // Update position if row data changed (and marker wasn't just dragged)
        const pos = existing.getLngLat();
        if (pos.lat !== row.lat || pos.lng !== row.lng) {
          existing.setLngLat([row.lng!, row.lat!]);
        }
      } else {
        // Create new draggable marker
        const el = document.createElement("div");
        el.className =
          "flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold text-white shadow-md cursor-grab active:cursor-grabbing";
        el.style.backgroundColor = row.selected ? "#3b82f6" : "#9ca3af";
        el.style.opacity = row.selected ? "1" : "0.5";
        el.textContent = String(rows.indexOf(row) + 1);

        const marker = new maplibregl.Marker({
          element: el,
          draggable: row.selected && row.isValid,
        })
          .setLngLat([row.lng!, row.lat!])
          .addTo(map);

        marker.on("dragend", () => {
          const pos = marker.getLngLat();
          onMarkerDrag(row.id, pos.lat, pos.lng);
        });

        markers.set(row.id, marker);
      }
    }

    // Remove stale markers
    for (const [id, marker] of markers) {
      if (!activeIds.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }

    // Fit bounds
    const coords: [number, number][] = validRows
      .filter((r) => r.selected)
      .map((r) => [r.lng!, r.lat!]);

    if (coords.length > 0) {
      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(coords[0], coords[0])
      );
      map.fitBounds(bounds, {
        padding: 60,
        maxZoom: 16,
        duration: 300,
      });
    }
  }, [rows, onMarkerDrag]);

  // Update marker appearance when selection changes
  useEffect(() => {
    for (const row of rows) {
      const marker = markersRef.current.get(row.id);
      if (marker && marker.getElement()) {
        const el = marker.getElement();
        el.style.backgroundColor = row.selected ? "#3b82f6" : "#9ca3af";
        el.style.opacity = row.selected ? "1" : "0.5";
        marker.setDraggable(row.selected && row.isValid);
      }
    }
  }, [rows]);

  return (
    <div
      ref={containerRef}
      className="map-container"
      style={{ width: "100%", height: "100%", minHeight: "500px" }}
    />
  );
}
