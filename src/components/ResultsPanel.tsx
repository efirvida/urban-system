"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Eye,
  EyeOff,
  House,
  Map as MapIcon,
  ChevronDown,
  BarChart3,
  Trophy,
} from "lucide-react";
import { DayRoute, OptimizerResult } from "@/types";
import { formatDistance, formatDuration, getRouteColor, cn } from "@/lib/utils";

interface ResultsPanelProps {
  days: DayRoute[];
  totalDistance: number;
  totalDays: number;
  totalLocations: number;
  hiddenDays?: Set<number>;
  onToggleDay?: (day: number) => void;
  onExpandDay?: (day: number) => void;
  routingLabel?: string;
  /** Controlled expanded day — when set, overrides internal state. */
  expandedDay?: number | null;
  /** Called when the user clicks a day header to expand/collapse. */
  onExpandedDayChange?: (day: number | null) => void;
  /**
   * Per-algorithm results from the registry. Each slot is either an
   * `OptimizerResult` or `null` (failed/unavailable). Order is the
   * registration order from the server. Optional — when absent, no tab
   * bar is rendered (single-algorithm legacy mode).
   */
  results?: (OptimizerResult | null)[];
  /** Algorithm id of the best (lowest totalDistance) entry — gets the trophy badge. */
  winnerAlgorithm?: string;
  /** Currently displayed algorithm id. */
  activeAlgorithm?: string | null;
  /** Called when the user picks a tab. */
  onAlgorithmChange?: (algorithm: string) => void;
  /** Consensus-matrix change: `_meta.useConsensus` flag from the API. */
  useConsensus?: boolean;
}

export default function ResultsPanel({
  days,
  totalDistance,
  totalDays,
  totalLocations,
  hiddenDays,
  onToggleDay,
  onExpandDay,
  routingLabel,
  expandedDay: controlledDay,
  onExpandedDayChange,
  results,
  winnerAlgorithm,
  activeAlgorithm,
  onAlgorithmChange,
  useConsensus,
}: ResultsPanelProps) {
  const [internalDay, setInternalDay] = useState<number | null>(1);
  const activeExpanded = controlledDay !== undefined ? controlledDay : internalDay;

  // Scroll to the expanded day when it changes
  useEffect(() => {
    if (activeExpanded === null) return;
    const el = document.getElementById(`result-day-${activeExpanded}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeExpanded]);

  /** Non-null entries in registration order — what we render as tabs. */
  const tabs = useMemo<(OptimizerResult & { index: number })[]>(() => {
    if (!results) return [];
    return results
      .map((r, index) => (r ? { ...r, index } : null))
      .filter((r): r is OptimizerResult & { index: number } => r !== null);
  }, [results]);

  return (
    <div className="space-y-4">
      {/* Algorithm tabs — only when the server returned multiple results. */}
      {tabs.length > 0 && (
        <div className="card-base overflow-hidden">
          <div className="card-header flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-600" />
            <span>Algoritmo</span>
          </div>
          <div className="card-body p-2">
            <div className="flex flex-col gap-1">
              {tabs.map((tab) => {
                const isActive = tab.algorithm === activeAlgorithm;
                const isWinner = tab.algorithm === winnerAlgorithm;
                return (
                  <button
                    key={tab.algorithm}
                    onClick={() => onAlgorithmChange?.(tab.algorithm)}
                    className={cn(
                      "flex items-center justify-between w-full text-left px-3 py-2 rounded-md text-sm transition-all",
                      isActive
                        ? "bg-blue-50 text-blue-800 shadow-sm border border-blue-300 font-medium"
                        : "text-gray-600 hover:bg-gray-50 border border-transparent",
                    )}
                    title={`${tab.label} — ${tab.totalDays}d · ${formatDistance(tab.totalDistance)}`}
                  >
                    <span className="flex items-center gap-2">
                      {isWinner && (
                        <Trophy className="w-3.5 h-3.5 text-amber-500" />
                      )}
                      <span className="font-medium">{tab.label}</span>
                      {tab.avgReliability !== undefined && (
                        <span
                          className={cn(
                            "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                            tab.avgReliability >= 0.67
                              ? "bg-green-100 text-green-700"
                              : tab.avgReliability >= 0.34
                                ? "bg-amber-100 text-amber-700"
                                : "bg-red-100 text-red-700",
                          )}
                          title={`Fiabilidad media: ${(tab.avgReliability * 100).toFixed(0)}%`}
                        >
                          {(tab.avgReliability * 100).toFixed(0)}%
                        </span>
                      )}
                    </span>
                    <span className="text-xs font-mono text-gray-500">
                      {tab.totalDays}d · {formatDistance(tab.totalDistance)}
                    </span>
                  </button>
                );
              })}
            </div>
            {tabs.length < (results?.length ?? 0) && (
              <div className="text-xs text-gray-400 mt-2 px-3">
                {results!.length - tabs.length} algoritmo
                {results!.length - tabs.length === 1 ? "" : "s"} no
                {tabs.length === 1 ? "" : "n"} disponible
                {tabs.length === 1 ? "" : "s"} (sin API key o falló).
              </div>
            )}
          </div>
        </div>
      )}

      {/* Global summary */}
      <div className="card-base">
        <div className="card-header flex items-center justify-between">
          <span className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-600" />
            Resumen Global
          </span>
          {routingLabel && (
            <span className="text-xs font-normal text-gray-400">{routingLabel}</span>
          )}
          {useConsensus && (
            <span className="text-[10px] font-medium text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full">
              Consenso 3 proveedores
            </span>
          )}
        </div>
        <div className="card-body grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-blue-600">{totalDays}</div>
            <div className="text-xs text-gray-500">Días</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600">
              {totalLocations}
            </div>
            <div className="text-xs text-gray-500">Ubicaciones</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-amber-600">
              {formatDistance(totalDistance)}
            </div>
            <div className="text-xs text-gray-500">Total recorrido</div>
          </div>
        </div>
      </div>

      {/* Per-day details */}
      {days.map((day) => {
        const color = getRouteColor(day.day - 1);
        const isExpanded = activeExpanded === day.day;
        const visitStops = day.stops.filter((s) => !s.isHome);

        return (
          <div key={day.day} id={`result-day-${day.day}`} className="card-base overflow-hidden">
          <div
            className="card-header flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer"
            onClick={() => {
              const newDay = isExpanded ? null : day.day;
              setInternalDay(newDay);
              onExpandedDayChange?.(newDay);
              if (newDay !== null && onExpandDay) onExpandDay(newDay);
            }}
          >
            <div className="flex items-center gap-3">
              <span
                className="w-3 h-3 rounded-full inline-block"
                style={{ backgroundColor: color }}
              />
              <span className="font-semibold">Día {day.day}</span>
              <span className="text-xs text-gray-400">
                {visitStops.length} paradas
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              {/* Toggle visibility — discrete eye icon */}
              {onToggleDay && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleDay(day.day);
                  }}
                  aria-label={
                    hiddenDays?.has(day.day)
                      ? `Mostrar día ${day.day} en mapa`
                      : `Ocultar día ${day.day} en mapa`
                  }
                  className={cn(
                    "w-7 h-7 flex items-center justify-center rounded-full border transition-colors text-xs",
                    hiddenDays?.has(day.day)
                      ? "border-gray-200 text-gray-300 hover:text-gray-500 hover:border-gray-300"
                      : "border-blue-200 text-blue-500 bg-blue-50 hover:bg-blue-100"
                  )}
                >
                  {hiddenDays?.has(day.day) ? (
                    <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                </button>
              )}
              <span>{formatDistance(day.totalDistance)}</span>
              <span>{formatDuration(day.totalTime)}</span>
              <ChevronDown
                className={cn(
                  "w-4 h-4 transition-transform",
                  isExpanded && "rotate-180"
                )}
              />
            </div>
            </div>

            {isExpanded && (
              <div className="card-body p-0">
                {/* Day summary bar */}
                <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b text-xs text-gray-500">
                  <span className="flex-1">{formatDistance(day.totalDistance)} distancia</span>
                  <span>{formatDuration(day.totalTime)} duración</span>
                  <span>{visitStops.length} visitas</span>
                  <a
                    href={(() => {
                      // Google Maps expects lat,lng format (NOT lng,lat)
                      const allStops = day.stops.map(s => `${s.lat},${s.lng}`).join("/");
                      return allStops ? `https://www.google.com/maps/dir/${allStops}/` : "#";
                    })()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-blue-500 hover:text-blue-700 underline shrink-0 inline-flex items-center gap-1"
                    title="Ver ruta en Google Maps"
                  >
                    <MapIcon className="w-3.5 h-3.5" />
                    Maps
                  </a>
                </div>

                {/* Stops list */}
                <div className="divide-y">
                  {day.stops.map((stop) => (
                    <div
                      key={stop.sequence}
                      className={cn(
                        "flex items-center gap-3 px-4 py-2.5 text-sm",
                        stop.isHome && "bg-blue-50/50"
                      )}
                    >
                      {/* Sequence badge */}
                      <span
                        className={cn(
                          "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                          stop.isHome
                            ? "bg-blue-100 text-blue-600"
                            : "bg-gray-100 text-gray-600"
                        )}
                      >
                        {stop.isHome ? (
                          <House className="w-3.5 h-3.5" />
                        ) : (
                          stop.sequence
                        )}
                      </span>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-800 truncate">
                          {stop.name}
                        </div>
                        {stop.distanceFromPrev > 0 && (
                          <div className="text-xs text-gray-400">
                            {formatDistance(stop.distanceFromPrev)} desde parada anterior
                          </div>
                        )}
                      </div>

                      {/* Cumulative */}
                      <div className="text-right text-xs text-gray-400 shrink-0">
                        {stop.cumulativeDistance > 0 && (
                          <div>{formatDistance(stop.cumulativeDistance)}</div>
                        )}
                        {stop.cumulativeTime > 0 && (
                          <div>{formatDuration(stop.cumulativeTime)}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
