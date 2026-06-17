"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, Clock, Eye, EyeOff, MapPin } from "lucide-react";
import { DayRoute, Config } from "@/types";
import { cn, formatDistance, formatDuration } from "@/lib/utils";
import StopItem from "./StopItem";

interface DayColumnProps {
  day: DayRoute;
  /** 0-based day index (used for color lookup). */
  dayIndex: number;
  color: string;
  config: Config;
  /** Called when the user clicks the X on a stop. */
  onRemoveStop: (stopSequence: number) => void;
  /** Called when the user clicks a stop row body. */
  onStopClick?: (name: string, lat: number, lng: number) => void;
  /** Stop name currently selected on the map (for highlight). */
  selectedStopName?: string | null;
  /** Whether this day is highlighted (selected on map). */
  highlighted?: boolean;
  /** Whether this day's route is hidden on the map. */
  hidden?: boolean;
  /** Called when the user toggles route visibility on the map. */
  onToggleVisibility?: () => void;
  /** Initial collapsed state — defaults to expanded. */
  defaultCollapsed?: boolean;
}

/**
 * Compute the binding constraint ratio for a day.
 * - hours:          usedHours / constraintValue
 * - visits:         visitCount / constraintValue
 * - hours+visits:   max(hoursRatio, visitsRatio) — the more restrictive
 *                   constraint (closer to its limit) is the one binding
 *                   the day. If hours are at 90% and visits at 60%,
 *                   hours is binding → gauge shows 90%.
 */
function computeGauge(
  day: DayRoute,
  config: Config
): { ratio: number; label: string; hoursRatio?: number; visitsRatio?: number } {
  const usedHours = day.totalTime;
  const visitCount = day.totalStops;

  switch (config.constraintType) {
    case "hours": {
      const ratio = config.constraintValue > 0 ? usedHours / config.constraintValue : 0;
      return { ratio, label: `${formatDuration(usedHours)} / ${config.constraintValue.toFixed(1)}h` };
    }
    case "visits": {
      const ratio = config.constraintValue > 0 ? visitCount / config.constraintValue : 0;
      return { ratio, label: `${visitCount} / ${Math.round(config.constraintValue)} visitas` };
    }
    case "hours+visits": {
      const hoursRatio = config.constraintValue > 0 ? usedHours / config.constraintValue : 0;
      const maxVisits = config.maxVisits ?? 10;
      const visitsRatio = visitCount / maxVisits;
      // Binding = larger ratio (closer to the constraint limit).
      const ratio = Math.max(hoursRatio, visitsRatio);
      return {
        ratio,
        label: `${formatDuration(usedHours)} / ${config.constraintValue.toFixed(1)}h  ·  ${visitCount} / ${maxVisits}`,
        hoursRatio,
        visitsRatio,
      };
    }
  }
}

function gaugeColor(ratio: number): string {
  if (ratio >= 1) return "bg-red-500";
  if (ratio >= 0.8) return "bg-amber-500";
  return "bg-emerald-500";
}

function gaugeTextColor(ratio: number): string {
  if (ratio >= 1) return "text-red-700";
  if (ratio >= 0.8) return "text-amber-700";
  return "text-emerald-700";
}

export default function DayColumn({
  day,
  dayIndex,
  color,
  config,
  onRemoveStop,
  onStopClick,
  selectedStopName,
  highlighted,
  hidden,
  onToggleVisibility,
  defaultCollapsed = false,
}: DayColumnProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  // The whole column body is a droppable zone.
  const { isOver, setNodeRef } = useDroppable({
    id: `day-${day.day}`,
    data: { kind: "day", dayIndex, dayNumber: day.day },
  });

  const gauge = computeGauge(day, config);
  const gaugeFillPct = Math.min(gauge.ratio, 1) * 100;
  const visitStops = day.stops.filter((s) => !s.isHome);

  return (
    <div
      className={cn(
        "rounded-lg border-2 transition-all",
        highlighted
          ? "border-blue-500 bg-blue-50/50 shadow-md"
          : "border-gray-200 bg-white"
      )}
    >
      {/* Header — clickable to collapse */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 transition-colors text-left"
        aria-expanded={!collapsed}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-3 h-3 rounded-full inline-block shrink-0"
            style={{ backgroundColor: color }}
          />
          <span className="text-sm font-semibold text-gray-800">
            Día {day.day}
          </span>
          <span className="text-[10px] text-gray-400 shrink-0">
            {visitStops.length} paradas
          </span>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-gray-500 shrink-0">
          {onToggleVisibility && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisibility();
              }}
              className={cn(
                "w-6 h-6 flex items-center justify-center rounded transition-colors",
                hidden
                  ? "text-gray-300 hover:text-gray-500"
                  : "text-gray-500 hover:text-blue-600"
              )}
              title={hidden ? "Mostrar ruta en mapa" : "Ocultar ruta en mapa"}
            >
              {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          )}
          <span>{formatDistance(day.totalDistance)}</span>
          <span>{formatDuration(day.totalTime)}</span>
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 transition-transform",
              !collapsed && "rotate-180"
            )}
          />
        </div>
      </button>

      {/* Constraint gauge — always visible, even when collapsed */}
      <div className="px-3 pb-2">
        <div className="flex items-center justify-between mb-1">
          <div
            className={cn(
              "flex items-center gap-1 text-[10px] font-medium",
              gaugeTextColor(gauge.ratio)
            )}
          >
            {config.constraintType === "visits" ? (
              <MapPin className="w-3 h-3" />
            ) : (
              <Clock className="w-3 h-3" />
            )}
            <span>{gauge.label}</span>
          </div>
          <span
            className={cn(
              "text-[10px] font-bold",
              gaugeTextColor(gauge.ratio)
            )}
          >
            {Math.round(gauge.ratio * 100)}%
          </span>
        </div>
        <div
          className="h-2 rounded-full bg-gray-200 overflow-hidden"
          role="progressbar"
          aria-valuenow={Math.round(gauge.ratio * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={cn("h-full rounded-full transition-all", gaugeColor(gauge.ratio))}
            style={{ width: `${gaugeFillPct}%` }}
          />
        </div>

        {/* For hours+visits show a second bar for the looser constraint */}
        {config.constraintType === "hours+visits" &&
          gauge.hoursRatio !== undefined &&
          gauge.visitsRatio !== undefined && (
            <SecondaryGaugeBar
              hoursRatio={gauge.hoursRatio}
              visitsRatio={gauge.visitsRatio}
            />
          )}
      </div>

      {/* Body — drop zone for incoming POIs */}
      {!collapsed && (
        <div
          ref={setNodeRef}
          className={cn(
            "px-3 pb-3 space-y-1.5 min-h-[40px] transition-colors",
            isOver && "bg-blue-50 ring-2 ring-blue-300 ring-inset"
          )}
        >
          {day.stops.map((stop) => (
            <StopItem
              key={`d${day.day}-s${stop.sequence}-${stop.lat.toFixed(5)}-${stop.lng.toFixed(5)}`}
              stop={stop}
              dayIndex={dayIndex}
              color={color}
              onRemove={() => onRemoveStop(stop.sequence)}
              onClick={() =>
                onStopClick?.(stop.name, stop.lat, stop.lng)
              }
              selected={selectedStopName === stop.name}
            />
          ))}

          {visitStops.length === 0 && (
            <div className="text-[10px] text-gray-400 italic text-center py-2">
              (Día vacío — soltar POIs aquí)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Tiny secondary bar for hours+visits mode showing the looser ratio. */
function SecondaryGaugeBar({
  hoursRatio,
  visitsRatio,
}: {
  hoursRatio: number;
  visitsRatio: number;
}) {
  // The binding (larger) one is shown in the main bar above. Show the
  // looser one as a thin secondary line so the user sees both.
  const loose = Math.min(hoursRatio, visitsRatio);
  const label =
    hoursRatio < visitsRatio
      ? `horas ${Math.round(hoursRatio * 100)}%`
      : `visitas ${Math.round(visitsRatio * 100)}%`;
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={cn("h-full rounded-full", gaugeColor(loose), "opacity-50")}
          style={{ width: `${Math.min(loose, 1) * 100}%` }}
        />
      </div>
      <span className="text-[9px] text-gray-400 shrink-0">{label}</span>
    </div>
  );
}
