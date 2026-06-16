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
  /** Passes the mapping + the (possibly re-headed) rows to apply it on */
  onConfirm: (mapping: ColumnMapping, rows: Record<string, unknown>[]) => void;
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
    <div className="space-y-4">
      <div>
        <p className="text-sm text-gray-500">
          Archivo: <span className="font-medium">{data.fileName}</span>
          &nbsp;·&nbsp; {effectiveData.columns.length} col,{" "}
          {effectiveData.rows.length} filas
        </p>
      </div>

      {/* Header row detection banner */}
      {headerCheck.isHeader && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <span>🔍</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-amber-800">
                Nombres detectados en la primera fila
              </p>
              <label className="flex items-center gap-2 cursor-pointer mt-1">
                <input
                  type="checkbox"
                  checked={useFirstRowAsHeaders}
                  onChange={(e) => handleReheader(e.target.checked)}
                  className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                />
                <span className="text-xs text-amber-700">
                  Usar como nombres de columna
                </span>
              </label>
              {useFirstRowAsHeaders && (
                <p className="text-xs text-green-600 mt-1 truncate">
                  ✓ {headerCheck.suggestedNames.filter((n) => n).join(", ")}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* DMS format banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-xs text-blue-700">
        <span className="font-medium">📐</span> Decimal (<code>-15.744</code>) y
        DMS (<code>15°02&apos;51.6&apos;&apos;S</code>)
      </div>

      {/* Column selectors */}
      <div className="space-y-2">
        {(Object.keys(FIELD_LABELS) as FieldKey[]).map((field) => (
          <div key={field}>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {FIELD_ICONS[field]} {FIELD_LABELS[field]}
            </label>
            <select
              value={mapping[field]}
              onChange={(e) => setField(field, e.target.value)}
              className="input-field text-sm"
            >
              <option value="">— Seleccionar —</option>
              {effectiveData.columns.map((col) => (
                <option key={col} value={col}>
                  {col} {col === suggested?.[field] ? "✓" : ""}
                </option>
              ))}
            </select>
            {!touched && suggested?.[field] && (
              <p className="text-xs text-green-600 mt-0.5">✓ Detectado</p>
            )}
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
          onClick={() => onConfirm(mapping, effectiveData.rows)}
          disabled={!allSelected}
          className="btn-primary"
        >
          Revisar ubicaciones →
        </button>
      </div>
    </div>
  );
}
