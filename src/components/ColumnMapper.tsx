"use client";

import { useState, useMemo } from "react";
import { RawFileData, ColumnMapping } from "@/types";
import { autoDetectMapping, applyMapping } from "@/utils/parser";

interface ColumnMapperProps {
  data: RawFileData;
  onConfirm: (mapping: ColumnMapping, previewCount: number) => void;
  onBack: () => void;
}

type FieldKey = "nameColumn" | "latColumn" | "lngColumn";

const FIELD_LABELS: Record<FieldKey, string> = {
  nameColumn: "Nombre",
  latColumn: "Latitud",
  lngColumn: "Longitud",
};

const FIELD_ICONS: Record<FieldKey, string> = {
  nameColumn: "🏷️",
  latColumn: "📍",
  lngColumn: "📍",
};

const FIELD_DETECT_VARIANTS: Record<FieldKey, string[]> = {
  nameColumn: ["nombre", "name", "location", "dirección", "direccion", "title"],
  latColumn: ["latitud", "latitude", "lat", "y", "coord_y", "coordenada_y"],
  lngColumn: [
    "longitud", "longitude", "lng", "lon", "long",
    "x", "coord_x", "coordenada_x",
  ],
};

export default function ColumnMapper({
  data,
  onConfirm,
  onBack,
}: ColumnMapperProps) {
  const suggested = useMemo(() => autoDetectMapping(data.columns), [data.columns]);

  const [mapping, setMapping] = useState<ColumnMapping>(() => {
    if (suggested) return suggested;
    return {
      nameColumn: data.columns[0] ?? "",
      latColumn: data.columns[1] ?? "",
      lngColumn: data.columns[2] ?? "",
    };
  });

  const [touched, setTouched] = useState(false);

  const previewRows = useMemo(() => {
    try {
      return applyMapping(data.rows, mapping).slice(0, 5);
    } catch {
      return [];
    }
  }, [data.rows, mapping]);

  const validCount = useMemo(() => {
    try {
      return applyMapping(data.rows, mapping).filter((r) => r.isValid).length;
    } catch {
      return 0;
    }
  }, [data.rows, mapping]);

  const allSelected = mapping.nameColumn && mapping.latColumn && mapping.lngColumn;

  const setField = (field: FieldKey, value: string) => {
    setTouched(true);
    setMapping((prev) => ({ ...prev, [field]: value }));
  };

  const isSuggested = (col: string, field: FieldKey): boolean => {
    const lower = col.toLowerCase().trim();
    return FIELD_DETECT_VARIANTS[field].some((v) => lower === v || lower.startsWith(v));
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Selecciona las columnas
        </h2>
        <p className="text-sm text-gray-500">
          Archivo: <span className="font-medium">{data.fileName}</span>
          &nbsp;·&nbsp; {data.columns.length} columnas, {data.rows.length} filas
        </p>
      </div>

      {/* Column selectors */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(Object.keys(FIELD_LABELS) as FieldKey[]).map((field) => (
          <div key={field} className="card-base">
            <div className="card-header">
              {FIELD_ICONS[field]} {FIELD_LABELS[field]}
            </div>
            <div className="card-body">
              <select
                value={mapping[field]}
                onChange={(e) => setField(field, e.target.value)}
                className="input-field"
              >
                <option value="">— Seleccionar columna —</option>
                {data.columns.map((col) => (
                  <option key={col} value={col}>
                    {col} {isSuggested(col, field) ? "✓" : ""}
                  </option>
                ))}
              </select>

              {!touched && suggested && (
                <p className="text-xs text-green-600 mt-1">
                  ✓ Detectado automáticamente
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Preview */}
      <div className="card-base">
        <div className="card-header">
          Vista previa ({validCount} de {data.rows.length} filas válidas)
        </div>
        <div className="card-body max-h-48 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 font-medium pr-3">#</th>
                <th className="pb-2 font-medium pr-3">{mapping.nameColumn || "Nombre"}</th>
                <th className="pb-2 font-medium pr-3">{mapping.latColumn || "Lat"}</th>
                <th className="pb-2 font-medium pr-3">{mapping.lngColumn || "Lng"}</th>
                <th className="pb-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="py-1.5 text-gray-400 pr-3">{i + 1}</td>
                  <td className="py-1.5 pr-3 font-medium truncate max-w-[160px]">
                    {row.rawName || <span className="text-gray-300 italic">vacío</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-gray-600">{row.rawLat}</td>
                  <td className="py-1.5 pr-3 text-gray-600">{row.rawLng}</td>
                  <td className="py-1.5">
                    {row.isValid ? (
                      <span className="text-green-600 text-xs">✓</span>
                    ) : (
                      <span className="text-red-500 text-xs" title={row.validationError}>
                        ✗
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {data.rows.length > 5 && (
                <tr>
                  <td colSpan={5} className="py-2 text-center text-xs text-gray-400">
                    ... y {data.rows.length - 5} filas más
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="btn-secondary">
          ← Volver
        </button>
        <div className="text-sm text-gray-500">
          {allSelected ? (
            <span className="text-green-600">
              {validCount} ubicaciones válidas listas
            </span>
          ) : (
            <span className="text-amber-600">Selecciona las 3 columnas</span>
          )}
        </div>
        <button
          onClick={() => onConfirm(mapping, validCount)}
          disabled={!allSelected}
          className="btn-primary"
        >
          Continuar →
        </button>
      </div>
    </div>
  );
}
