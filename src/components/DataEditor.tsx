"use client";

import { useCallback, useRef, useEffect } from "react";
import { ValidatedRow, Location } from "@/types";
import { cn } from "@/lib/utils";
import LocationMapEditor from "./LocationMapEditor";

interface DataEditorProps {
  rows: ValidatedRow[];
  onChange: (rows: ValidatedRow[]) => void;
  onConfirm: (locations: Location[]) => void;
  onBack: () => void;
}

export default function DataEditor({
  rows,
  onChange,
  onConfirm,
  onBack,
}: DataEditorProps) {
  const selectedCount = rows.filter((r) => r.selected && r.isValid).length;

  // ── Toggle row selection ──

  const handleToggleRow = useCallback(
    (id: string) => {
      onChange(
        rows.map((r) => (r.id === id ? { ...r, selected: !r.selected } : r))
      );
    },
    [rows, onChange]
  );

  // ── Edit a single field ──

  const handleEditField = useCallback(
    (id: string, field: "name" | "lat" | "lng", value: string) => {
      onChange(
        rows.map((r) => {
          if (r.id !== id) return r;

          let newName = r.name;
          let newLat = r.lat;
          let newLng = r.lng;
          let newRawLat = r.rawLat;
          let newRawLng = r.rawLng;
          const newErrors: string[] = [];

          if (field === "name") {
            newName = value.trim();
            if (!newName) newErrors.push("Nombre vacío");
          } else if (field === "lat") {
            newRawLat = value;
            const parsed = parseFloat(value.replace(",", "."));
            if (isNaN(parsed)) {
              newErrors.push("Latitud inválida");
              newLat = null;
            } else if (parsed < -90 || parsed > 90) {
              newErrors.push("Latitud fuera de rango");
              newLat = parsed;
            } else {
              newLat = parsed;
            }
          } else if (field === "lng") {
            newRawLng = value;
            const parsed = parseFloat(value.replace(",", "."));
            if (isNaN(parsed)) {
              newErrors.push("Longitud inválida");
              newLng = null;
            } else if (parsed < -180 || parsed > 180) {
              newErrors.push("Longitud fuera de rango");
              newLng = parsed;
            } else {
              newLng = parsed;
            }
          }

          return {
            ...r,
            name: newName,
            lat: newLat,
            lng: newLng,
            rawLat: newRawLat,
            rawLng: newRawLng,
            isValid: newErrors.length === 0,
            validationError:
              newErrors.length > 0 ? newErrors.join("; ") : undefined,
            edited: true,
          };
        })
      );
    },
    [rows, onChange]
  );

  // ── Marker drag callback ──
  // Stable ref-based — never changes.

  const onMarkerDrag = useCallback(
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

  // ── Confirm → emit locations ──

  const handleConfirm = useCallback(() => {
    const locations: Location[] = rows
      .filter(
        (r) => r.selected && r.isValid && r.lat !== null && r.lng !== null
      )
      .map((r) => ({ name: r.name, lat: r.lat!, lng: r.lng! }));
    onConfirm(locations);
  }, [rows, onConfirm]);

  // ── Keyboard shortcuts ──

  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Space on a checkbox-like context toggles selection
      if (e.key === " " && e.target instanceof HTMLInputElement) {
        // Let the native checkbox handle space
        return;
      }
    };
    el.addEventListener("keydown", handleKeyDown);
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ── Render ──

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

      <div
        className="grid grid-cols-1 lg:grid-cols-5 gap-4"
        style={{ minHeight: "70vh" }}
      >
        {/* ─── Left: Table ─── */}
        <div className="lg:col-span-2 card-base overflow-hidden flex flex-col">
          <div className="card-header flex items-center justify-between">
            <span>Tabla de datos</span>
            <span className="text-xs text-gray-400">
              Arrastra en el mapa o edita aquí
            </span>
          </div>
          <div ref={tableRef} className="flex-1 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="border-b text-left text-gray-500 text-xs">
                  <th className="p-2 w-8"></th>
                  <th className="p-2 font-medium">Nombre</th>
                  <th className="p-2 font-medium">Latitud</th>
                  <th className="p-2 font-medium">Longitud</th>
                  <th className="p-2 w-6"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="p-8 text-center text-sm text-gray-400"
                    >
                      No hay filas para mostrar
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b last:border-0 transition-colors",
                      !row.selected && "opacity-40",
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
                        className="w-full bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none px-1 py-0.5"
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
                ))}
              </tbody>
            </table>
          </div>

          {/* Quick actions footer */}
          <div className="border-t px-2 py-1.5 bg-gray-50 flex items-center gap-2 text-xs text-gray-500">
            <button
              onClick={() =>
                onChange(
                  rows.map((r) => ({
                    ...r,
                    selected: r.isValid,
                  }))
                )
              }
              className="hover:text-blue-600 transition-colors"
            >
              ✓ Solo válidas
            </button>
            <button
              onClick={() =>
                onChange(rows.map((r) => ({ ...r, selected: true })))
              }
              className="hover:text-blue-600 transition-colors"
            >
              ✓ Todas
            </button>
            <button
              onClick={() =>
                onChange(rows.map((r) => ({ ...r, selected: false })))
              }
              className="hover:text-red-600 transition-colors"
            >
              ✗ Ninguna
            </button>
          </div>
        </div>

        {/* ─── Right: Map ─── */}
        <div className="lg:col-span-3 card-base overflow-hidden">
          <div className="card-header">
            Mapa interactivo — arrastra los marcadores
          </div>
          <div className="card-body p-0" style={{ height: "calc(70vh - 45px)" }}>
            <LocationMapEditor rows={rows} onMarkerDrag={onMarkerDrag} />
          </div>
        </div>
      </div>

      {/* ─── Actions bar ─── */}
      <div className="flex items-center justify-between border-t pt-4">
        <button onClick={onBack} className="btn-secondary">
          ← Volver a columnas
        </button>

        <div className="text-sm text-gray-500">
          {selectedCount === 0
            ? "Seleccioná al menos una ubicación"
            : `${selectedCount} ubicación${selectedCount !== 1 ? "es" : ""} lista${selectedCount !== 1 ? "s" : ""} para optimizar`}
        </div>

        <button
          onClick={handleConfirm}
          disabled={selectedCount === 0}
          className="btn-primary"
        >
          {selectedCount > 0
            ? `Confirmar ${selectedCount} →`
            : "Selecciona al menos una"}
        </button>
      </div>
    </div>
  );
}
