"use client";

import { useState, useMemo, useCallback } from "react";
import { RawFileData, ColumnMapping } from "@/types";
import {
  autoDetectMapping,
  applyMapping,
  detectHeaderRow,
  reheader,
} from "@/utils/parser";

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

export default function ColumnMapper({
  data,
  onConfirm,
  onBack,
}: ColumnMapperProps) {
  // Detect header row issue
  const headerCheck = useMemo(() => detectHeaderRow(data.rows), [data.rows]);

  const [useFirstRowAsHeaders, setUseFirstRowAsHeaders] = useState(
    headerCheck.isHeader
  );
  const [touched, setTouched] = useState(false);

  // Compute effective data (re-headed or original)
  const effectiveData = useMemo((): RawFileData => {
    if (useFirstRowAsHeaders && headerCheck.isHeader) {
      return reheader(data, headerCheck.suggestedNames);
    }
    return data;
  }, [data, useFirstRowAsHeaders, headerCheck]);

  // Auto-detect on effective columns
  const suggested = useMemo(
    () => autoDetectMapping(effectiveData.columns),
    [effectiveData.columns]
  );

  const [mapping, setMapping] = useState<ColumnMapping>(() => {
    if (suggested) return suggested;
    return {
      nameColumn: effectiveData.columns[0] ?? "",
      latColumn: effectiveData.columns[1] ?? "",
      lngColumn: effectiveData.columns[2] ?? "",
    };
  });

  // Sync mapping when effective columns change
  const handleReheader = useCallback(
    (use: boolean) => {
      setUseFirstRowAsHeaders(use);
      setTouched(false);
      if (use && headerCheck.isHeader) {
        const re = reheader(data, headerCheck.suggestedNames);
        const auto = autoDetectMapping(re.columns);
        if (auto) setMapping(auto);
      } else {
        const auto = autoDetectMapping(data.columns);
        if (auto) setMapping(auto);
      }
    },
    [data, headerCheck]
  );

  const previewRows = useMemo(() => {
    try {
      return applyMapping(effectiveData.rows, mapping).slice(0, 5);
    } catch {
      return [];
    }
  }, [effectiveData.rows, mapping]);

  const validCount = useMemo(() => {
    try {
      return applyMapping(effectiveData.rows, mapping).filter((r) => r.isValid)
        .length;
    } catch {
      return 0;
    }
  }, [effectiveData.rows, mapping]);

  const allSelected =
    mapping.nameColumn && mapping.latColumn && mapping.lngColumn;

  const setField = (field: FieldKey, value: string) => {
    setTouched(true);
    setMapping((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Selecciona las columnas
        </h2>
        <p className="text-sm text-gray-500">
          Archivo: <span className="font-medium">{data.fileName}</span>
          &nbsp;·&nbsp; {effectiveData.columns.length} columnas,{" "}
          {effectiveData.rows.length} filas
        </p>
      </div>

      {/* Header row detection banner */}
      {headerCheck.isHeader && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <span className="text-lg">🔍</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800">
                Se detectaron nombres de columna en la primera fila
              </p>
              <p className="text-xs text-amber-600 mt-1">
                El archivo tiene celdas combinadas. Los nombres reales de las
                columnas están en la primera fila de datos.
              </p>
              <div className="mt-2 flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useFirstRowAsHeaders}
                    onChange={(e) => handleReheader(e.target.checked)}
                    className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-sm text-amber-700">
                    Usar primera fila como nombres de columna
                  </span>
                </label>
                {useFirstRowAsHeaders && (
                  <span className="text-xs text-green-600">
                    ✓ Nombres detectados:{" "}
                    {headerCheck.suggestedNames
                      .filter((n) => n)
                      .slice(0, 5)
                      .join(", ")}
                    {headerCheck.suggestedNames.filter((n) => n).length > 5
                      ? "..."
                      : ""}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DMS format banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
        <span className="font-medium">📐</span> Se aceptan coordenadas en
        formato decimal (<code>-15.744</code>) y grados-minutos-segundos (
        <code>15°02&apos;51.6&apos;&apos;S</code>).
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
                {effectiveData.columns.map((col) => {
                  const isSuggested = suggested?.[field] === col;
                  return (
                    <option key={col} value={col}>
                      {col} {col === suggested?.[field] ? "✓" : ""}
                    </option>
                  );
                })}
              </select>

              {!touched && suggested?.[field] && (
                <p className="text-xs text-green-600 mt-1">✓ Detectado</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Preview */}
      <div className="card-base">
        <div className="card-header flex items-center justify-between">
          <span>
            Vista previa ({validCount} de {effectiveData.rows.length} filas
            válidas)
          </span>
          <span className="text-xs text-gray-400">
            Mapeo actual: {mapping.nameColumn} → Nombre, {mapping.latColumn}{" "}
            → Lat, {mapping.lngColumn} → Lng
          </span>
        </div>
        <div className="card-body max-h-56 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 font-medium pr-3">#</th>
                <th className="pb-2 font-medium pr-3">
                  {mapping.nameColumn || "Nombre"}
                </th>
                <th className="pb-2 font-medium pr-3">
                  {mapping.latColumn || "Lat"}
                </th>
                <th className="pb-2 font-medium pr-3">
                  {mapping.lngColumn || "Lng"}
                </th>
                <th className="pb-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="py-1.5 text-gray-400 pr-3">{i + 1}</td>
                  <td className="py-1.5 pr-3 font-medium truncate max-w-[200px]">
                    {row.rawName || (
                      <span className="text-gray-300 italic">vacío</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-gray-600 font-mono text-xs">
                    {row.rawLat}
                  </td>
                  <td className="py-1.5 pr-3 text-gray-600 font-mono text-xs">
                    {row.rawLng}
                  </td>
                  <td className="py-1.5">
                    {row.isValid ? (
                      <span
                        className="text-green-600 text-xs"
                        title={`${row.lat}, ${row.lng}`}
                      >
                        ✓
                      </span>
                    ) : (
                      <span
                        className="text-red-500 text-xs cursor-help"
                        title={row.validationError}
                      >
                        ✗ {row.validationError}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {effectiveData.rows.length > 5 && (
                <tr>
                  <td
                    colSpan={5}
                    className="py-2 text-center text-xs text-gray-400"
                  >
                    ... y {effectiveData.rows.length - 5} filas más
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
              {validCount} ubicaciones válidas de {effectiveData.rows.length}
            </span>
          ) : (
            <span className="text-amber-600">
              Selecciona las 3 columnas para continuar
            </span>
          )}
        </div>
        <button
          onClick={() => onConfirm(mapping, validCount)}
          disabled={!allSelected}
          className="btn-primary"
        >
          Revisar ubicaciones →
        </button>
      </div>
    </div>
  );
}
