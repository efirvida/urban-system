"use client";

import { MapPin, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Special value meaning "remove from route" (unassigned). */
export const UNASSIGNED = 0;

interface MapPOIActionBarProps {
  poiName: string;
  currentDay: number;
  availableDays: number[];
  /** Preview target: a day number, UNASSIGNED (0) for unassigned, or null if no preview. */
  previewTargetDay: number | null;
  /** Called when user selects a day. day=UNASSIGNED means remove from route, day=null means deselect. */
  onSelectDay: (day: number | null) => void;
  onAccept: () => void;
  onCancel: () => void;
}

export default function MapPOIActionBar({
  poiName,
  currentDay,
  availableDays,
  previewTargetDay,
  onSelectDay,
  onAccept,
  onCancel,
}: MapPOIActionBarProps) {
  const hasPreview = previewTargetDay !== null && previewTargetDay !== currentDay;

  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
      <div className="pointer-events-auto bg-white rounded-xl shadow-2xl border border-blue-100 p-3 min-w-[400px] max-w-[500px]">
        {/* POI info */}
        <div className="flex items-center gap-2 mb-2.5 pb-2 border-b border-gray-100">
          <MapPin className="w-4 h-4 text-blue-600 shrink-0" />
          <span className="font-semibold text-sm text-gray-800 truncate">
            {poiName}
          </span>
          <span className="text-xs text-gray-400">·</span>
          <span className="text-xs font-medium text-blue-600">
            Día {currentDay}
          </span>
        </div>

        {/* Day selector */}
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {availableDays.map((d) => {
            const isCurrent = d === currentDay && !hasPreview;
            const isSelected = d === previewTargetDay;
            return (
              <button
                key={d}
                onClick={() => onSelectDay(isSelected ? null : d)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
                  isSelected && "ring-2 ring-blue-500 bg-blue-50 text-blue-700 border-blue-300",
                  isCurrent && "bg-blue-100 text-blue-700 border-blue-200 font-semibold",
                  !isCurrent && !isSelected && "bg-white text-gray-700 hover:bg-gray-50 border-gray-200",
                )}
              >
                {isCurrent && !isSelected && "✓ "}Día {d}
              </button>
            );
          })}
          <button
            onClick={() => onSelectDay(previewTargetDay === UNASSIGNED ? null : UNASSIGNED)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
              previewTargetDay === UNASSIGNED
                ? "ring-2 ring-amber-500 bg-amber-50 text-amber-700 border-amber-300"
                : "bg-white text-gray-700 hover:bg-gray-50 border-gray-200",
            )}
          >
            {previewTargetDay === UNASSIGNED ? "✓ " : ""}Sin ruta
          </button>
        </div>

        {/* Accept / Cancel — only show when preview differs from current */}
        {hasPreview && (
          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <button
              onClick={onAccept}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              Aceptar
            </button>
            <button
              onClick={onCancel}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white text-gray-600 text-xs font-medium border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
