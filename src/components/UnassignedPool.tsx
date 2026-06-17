"use client";

import { useDroppable, useDraggable } from "@dnd-kit/core";
import { MapPin } from "lucide-react";
import { Location } from "@/types";
import { cn } from "@/lib/utils";

interface UnassignedPoolProps {
  pois: Location[];
}

/**
 * Drop zone for POIs that are NOT in any day. StopItems dropped here are
 * removed from their source day and re-added to the unassigned pool.
 *
 * Each POI is itself draggable — pick it up to add it to a DayColumn.
 */
export default function UnassignedPool({ pois }: UnassignedPoolProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: "pool-unassigned",
    data: { kind: "pool" },
  });

  if (pois.length === 0) return null;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg p-3 border-2 border-dashed transition-colors",
        isOver
          ? "border-amber-400 bg-amber-50"
          : "border-gray-300 bg-amber-50/40"
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <MapPin className="w-3.5 h-3.5 text-amber-600" />
        <span className="text-xs font-semibold text-amber-700">
          POIs sin ruta ({pois.length})
        </span>
      </div>

      <div className="flex flex-wrap gap-1">
        {pois.map((poi, idx) => (
          <UnassignedChip key={`${poi.lat.toFixed(5)}-${poi.lng.toFixed(5)}-${idx}`} poi={poi} />
        ))}
      </div>
    </div>
  );
}

/** A single draggable POI chip in the unassigned pool. */
function UnassignedChip({ poi }: { poi: Location }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `pool-${poi.lat.toFixed(5)}-${poi.lng.toFixed(5)}-${poi.name}`,
      data: {
        kind: "pool-item",
        name: poi.name,
        lat: poi.lat,
        lng: poi.lng,
      },
    });

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      className={cn(
        "text-[10px] px-2 py-0.5 rounded-full border touch-none cursor-grab active:cursor-grabbing transition-colors",
        "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200",
        isDragging && "shadow-md ring-2 ring-amber-300"
      )}
      title={`${poi.name} — arrastrar a un día`}
      {...listeners}
      {...attributes}
    >
      + {poi.name.length > 18 ? poi.name.slice(0, 18) + "…" : poi.name}
    </button>
  );
}
