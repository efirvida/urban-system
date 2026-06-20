"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, X, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ValidatedRow, Location } from "@/types";
import { cn } from "@/lib/utils";

interface DataEditorProps {
  rows: ValidatedRow[];
  onChange: (rows: ValidatedRow[]) => void;
  onConfirm: (locations: Location[]) => void;
  onBack: () => void;
}

type FilterOption = "all" | "valid" | "invalid" | "selected" | "unselected";

const FILTER_KEYS: FilterOption[] = ["all", "valid", "invalid", "selected", "unselected"];

export default function DataEditor({
  rows,
  onChange,
  onConfirm,
  onBack,
}: DataEditorProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterOption>("all");

  const selectedCount = rows.filter((r) => r.selected && r.isValid).length;

  // ── Filtered rows ──
  const filteredRows = useMemo(() => {
    let result = rows;

    // Search by name
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.rawLat.includes(q) ||
          r.rawLng.includes(q)
      );
    }

    // Filter by status
    switch (filter) {
      case "valid":
        result = result.filter((r) => r.isValid);
        break;
      case "invalid":
        result = result.filter((r) => !r.isValid);
        break;
      case "selected":
        result = result.filter((r) => r.selected);
        break;
      case "unselected":
        result = result.filter((r) => !r.selected);
        break;
    }

    return result;
  }, [rows, search, filter]);

  // ── Row toggle ──
  const handleToggleRow = useCallback(
    (id: string) => {
      onChange(
        rows.map((r) => (r.id === id ? { ...r, selected: !r.selected } : r))
      );
    },
    [rows, onChange]
  );

  // ── Edit field ──
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
          const errors: string[] = [];

          if (field === "name") {
            newName = value.trim();
            if (!newName) errors.push(t("dataEditor.errors.emptyName"));
          } else if (field === "lat") {
            newRawLat = value;
            const p = parseFloat(value.replace(",", "."));
            if (isNaN(p)) {
              errors.push(t("dataEditor.errors.invalidLat"));
              newLat = null;
            } else if (p < -90 || p > 90) {
              errors.push(t("dataEditor.errors.latOutOfRange"));
              newLat = p;
            } else {
              newLat = p;
            }
          } else if (field === "lng") {
            newRawLng = value;
            const p = parseFloat(value.replace(",", "."));
            if (isNaN(p)) {
              errors.push(t("dataEditor.errors.invalidLng"));
              newLng = null;
            } else if (p < -180 || p > 180) {
              errors.push(t("dataEditor.errors.lngOutOfRange"));
              newLng = p;
            } else {
              newLng = p;
            }
          }

          return {
            ...r,
            name: newName,
            lat: newLat,
            lng: newLng,
            rawLat: newRawLat,
            rawLng: newRawLng,
            isValid: errors.length === 0,
            validationError: errors.length > 0 ? errors.join("; ") : undefined,
            edited: true,
          };
        })
      );
    },
    [rows, onChange, t]
  );

  // ── Confirm ──
  const handleConfirm = useCallback(() => {
    const locations = rows
      .filter((r) => r.selected && r.isValid && r.lat !== null && r.lng !== null)
      .map((r) => ({ name: r.name, lat: r.lat!, lng: r.lng! }));
    onConfirm(locations);
  }, [rows, onConfirm]);

  // ── Quick actions ──
  const bulkSelect = useCallback(
    (predicate: (r: ValidatedRow) => boolean) => {
      onChange(rows.map((r) => ({ ...r, selected: predicate(r) })));
    },
    [rows, onChange]
  );

  return (
    <div className="flex flex-col h-full gap-3">
      {/* ── Search + filters ── */}
      <div className="space-y-2">
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
            aria-hidden="true"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("dataEditor.searchPlaceholder")}
            className="input-field pl-8 text-sm"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {FILTER_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                "text-xs px-2.5 py-1 rounded-full border transition-colors",
                filter === key
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-500 border-gray-200 hover:border-blue-300"
              )}
            >
              {t(`dataEditor.filters.${key}`)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-400">
          <button
            onClick={() => bulkSelect((r) => r.isValid)}
            className="hover:text-blue-600 transition-colors inline-flex items-center gap-1"
          >
            <Check className="w-3 h-3" />
            Solo válidas
          </button>
          <span>·</span>
          <button
            onClick={() => bulkSelect(() => true)}
            className="hover:text-blue-600 transition-colors inline-flex items-center gap-1"
          >
            <Check className="w-3 h-3" />
            Todas
          </button>
          <span>·</span>
          <button
            onClick={() => bulkSelect(() => false)}
            className="hover:text-red-500 transition-colors inline-flex items-center gap-1"
          >
            <X className="w-3 h-3" />
            Ninguna
          </button>
        </div>
      </div>

      {/* ── Row count ── */}
      <div className="text-xs text-gray-400">
        Mostrando {filteredRows.length} de {rows.length} filas
        &middot; {selectedCount} seleccionadas
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-y-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b text-left text-gray-500 text-xs">
              <th className="p-2 w-8"></th>
              <th className="p-2 font-medium">Nombre</th>
              <th className="p-2 font-medium">Lat</th>
              <th className="p-2 font-medium">Lng</th>
              <th className="p-2 w-6"></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-sm text-gray-400">
                  {search
                    ? t("dataEditor.empty.noResults")
                    : t("dataEditor.empty.noRows")}
                </td>
              </tr>
            )}
            {filteredRows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "border-b last:border-0 transition-colors hover:bg-gray-50",
                  !row.selected && "bg-gray-50/50"
                )}
              >
                <td className="p-1.5 pl-2">
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={() => handleToggleRow(row.id)}
                    aria-label={`Seleccionar ${row.name || "fila"}`}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </td>
                <td className="p-1.5">
                  <input
                    value={row.name}
                    onChange={(e) =>
                      handleEditField(row.id, "name", e.target.value)
                    }
                    className="w-full bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none px-1 py-0.5"
                    placeholder={t("dataEditor.placeholders.noName")}
                  />
                </td>
                <td className="p-1.5">
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
                <td className="p-1.5">
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
                <td className="p-1.5 pr-2">
                  {row.validationError ? (
                    <span
                      className="text-red-500 cursor-help"
                      title={row.validationError}
                    >
                      <X className="w-3.5 h-3.5" aria-label={row.validationError} />
                    </span>
                  ) : (
                    <span className="text-green-500">
                      <Check className="w-3.5 h-3.5" aria-label={t("dataEditor.ariaLabels.validRow")} />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Actions ── */}
      <div className="flex items-center justify-between border-t pt-3">
        <button onClick={onBack} className="btn-secondary text-sm">
          ← Columnas
        </button>
        <button
          onClick={handleConfirm}
          disabled={selectedCount === 0}
          className="btn-primary text-sm"
        >
          {selectedCount > 0
            ? `Confirmar ${selectedCount} →`
            : t("dataEditor.selectionHint")}
        </button>
      </div>
    </div>
  );
}
