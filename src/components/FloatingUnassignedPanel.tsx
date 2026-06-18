"use client";

import { MapPin, Crosshair } from "lucide-react";
import { Location } from "@/types";
import { cn } from "@/lib/utils";

interface FloatingUnassignedPanelProps {
  pois: Location[];
  onPOIClick?: (lat: number, lng: number, name: string) => void;
}

export default function FloatingUnassignedPanel({
  pois,
  onPOIClick,
}: FloatingUnassignedPanelProps) {
  if (pois.length === 0) return null;

  return (
    <div className="absolute right-4 top-4 z-30 max-w-[220px] pointer-events-none">
      <div className="pointer-events-auto bg-white rounded-xl shadow-lg border border-red-100 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2.5 bg-gradient-to-r from-red-50 to-amber-50 border-b border-red-100">
          <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center shrink-0">
            <MapPin className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-red-800 leading-tight">
              POIs sin ruta
            </div>
            <div className="text-[10px] text-red-500 font-medium">
              {pois.length} pendiente{pois.length !== 1 ? "s" : ""}
            </div>
          </div>
        </div>

        {/* List */}
        <div className="max-h-[50vh] overflow-y-auto divide-y divide-gray-50">
          {pois.map((poi, idx) => (
            <button
              key={`${poi.lat.toFixed(5)}-${poi.lng.toFixed(5)}-${idx}`}
              onClick={() => onPOIClick?.(poi.lat, poi.lng, poi.name)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-blue-50 transition-colors group"
            >
              <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center shrink-0 group-hover:bg-red-200 transition-colors">
                <span className="text-[9px] font-bold text-red-600">{idx + 1}</span>
              </div>
              <span className="text-[11px] text-gray-700 truncate flex-1 group-hover:text-blue-700 transition-colors">
                {poi.name}
              </span>
              <Crosshair className="w-3 h-3 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </button>
          ))}
        </div>

        {/* Footer hint */}
        {pois.length > 0 && (
          <div className="px-3 py-1.5 bg-gray-50 border-t border-gray-100">
            <p className="text-[9px] text-gray-400 text-center">
              Click para asignar a una ruta
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
