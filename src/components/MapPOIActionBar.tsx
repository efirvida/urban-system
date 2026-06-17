"use client";

import { MapPin, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface MapPOIActionBarProps {
  poiName: string;
  currentDay: number;
  availableDays: number[];
  previewTargetDay: number | null;
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
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                  isSelected && "ring-2 ring-blue-500 bg-blue-50 text-blue-700",
                  isCurrent && !isSelected && "bg-gray-100 text-gray-400 cursor-not-allowed",
                  !isCurrent && !isSelected && "bg-white text-gray-700 hover:bg-gray-50 border border-gray-200",
                )}
                disabled={isCurrent && !isSelected}
              >
                Día {d}
              </button>
            );
          })}
          <button
            onClick={() => onSelectDay(previewTargetDay === null ? null : null)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
              previewTargetDay === null && currentDay !== 0
                ? "ring-2 ring-amber-500 bg-amber-50 text-amber-700"
                : "bg-white text-gray-700 hover:bg-gray-50 border-gray-200",
            )}
          >
            Sin ruta
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
