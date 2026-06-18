"use client";

import { MapPin } from "lucide-react";
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
    <div className="absolute right-4 top-4 z-30 max-w-[200px] pointer-events-none">
      <div className="pointer-events-auto bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-amber-200 p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <MapPin className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span className="text-xs font-semibold text-amber-800">
            Sin ruta ({pois.length})
          </span>
        </div>
        <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
          {pois.map((poi, idx) => (
            <button
              key={`${poi.lat.toFixed(5)}-${poi.lng.toFixed(5)}-${idx}`}
              onClick={() => onPOIClick?.(poi.lat, poi.lng, poi.name)}
              className="text-[11px] text-left px-2 py-1 rounded-md bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200 transition-colors truncate"
              title={poi.name}
            >
              📍 {poi.name.length > 22 ? poi.name.slice(0, 22) + "…" : poi.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
