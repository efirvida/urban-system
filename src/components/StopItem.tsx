"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { X, GripVertical } from "lucide-react";
import { Stop } from "@/types";
import { formatDistance } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface StopItemProps {
  stop: Stop;
  /** Day number (1-based) — used to make the dnd-kit drag id unique. */
  dayIndex: number;
  /** Color of the parent day (hex). */
  color: string;
  /** Called when the user clicks the X button. */
  onRemove: () => void;
  /** Called when the user clicks the row body. */
  onClick?: () => void;
  /** Whether this stop is currently selected (highlighted). */
  selected?: boolean;
}

/**
 * A single stop inside a DayColumn.
 *
 * Draggable — picked up by the drag handle. The drop is interpreted by
 * RouteEditor.handleDragEnd; within-day drops are explicitly ignored
 * (the day's order is always reoptimized).
 */
export default function StopItem({
  stop,
  dayIndex,
  color,
  onRemove,
  onClick,
  selected,
}: StopItemProps) {
  const { isHome } = stop;
  const dragId = `stop-${dayIndex}-${stop.sequence}-${stop.lat.toFixed(5)}-${stop.lng.toFixed(5)}`;
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: dragId,
      data: {
        kind: "stop",
        dayIndex,
        name: stop.name,
        lat: stop.lat,
        lng: stop.lng,
      },
    });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors",
        isHome
          ? "bg-blue-50/60 border border-blue-100"
          : "bg-gray-50 hover:bg-gray-100",
        selected && !isHome && "ring-2 ring-blue-400 bg-blue-50",
        isDragging && "shadow-lg ring-2 ring-blue-300"
      )}
    >
      {/* Drag handle */}
      <button
        type="button"
        className="touch-none text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing"
        aria-label="Arrastrar parada"
        {...listeners}
        {...attributes}
      >
        <GripVertical className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      {/* Sequence badge */}
      <span
        className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
          isHome ? "bg-blue-200 text-blue-700" : "text-white"
        )}
        style={!isHome ? { backgroundColor: color } : undefined}
      >
        {isHome ? "H" : stop.sequence}
      </span>

      {/* Info — clickable for highlight */}
      <button
        type="button"
        onClick={onClick}
        className="flex-1 min-w-0 text-left"
        title={isHome ? "Casa" : stop.name}
      >
        <div className="font-medium text-gray-800 truncate text-left">
          {stop.name}
        </div>
        {!isHome && stop.distanceFromPrev > 0 && (
          <div className="text-[10px] text-gray-400 truncate text-left">
            {formatDistance(stop.distanceFromPrev)} desde anterior
          </div>
        )}
      </button>

      {/* Remove button — hidden for home */}
      {!isHome && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Quitar parada"
          className="text-gray-300 hover:text-red-500 transition-colors"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
