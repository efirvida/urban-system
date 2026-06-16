"use client";

import { useState } from "react";
import { DayRoute } from "@/types";
import { formatDistance, formatDuration, getRouteColor } from "@/lib/utils";

interface ResultsPanelProps {
  days: DayRoute[];
  totalDistance: number;
  totalDays: number;
  totalLocations: number;
}

export default function ResultsPanel({
  days,
  totalDistance,
  totalDays,
  totalLocations,
}: ResultsPanelProps) {
  const [expandedDay, setExpandedDay] = useState<number>(1);

  return (
    <div className="space-y-4">
      {/* Global summary */}
      <div className="card-base">
        <div className="card-header">📊 Resumen Global</div>
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
        const isExpanded = expandedDay === day.day;
        const visitStops = day.stops.filter((s) => !s.isHome);

        return (
          <div key={day.day} className="card-base overflow-hidden">
            <button
              onClick={() =>
                setExpandedDay(isExpanded ? -1 : day.day)
              }
              className="w-full text-left"
            >
              <div
                className="card-header flex items-center justify-between hover:bg-gray-50 transition-colors"
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
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>{formatDistance(day.totalDistance)}</span>
                  <span>{formatDuration(day.totalTime)}</span>
                  <svg
                    className={`w-4 h-4 transition-transform ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </div>
              </div>
            </button>

            {isExpanded && (
              <div className="card-body p-0">
                {/* Day summary bar */}
                <div className="grid grid-cols-3 gap-2 px-4 py-3 bg-gray-50 border-b text-xs text-gray-500">
                  <div>
                    <span className="font-medium text-gray-700">
                      {formatDistance(day.totalDistance)}
                    </span>{" "}
                    distancia
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">
                      {formatDuration(day.totalTime)}
                    </span>{" "}
                    duración
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">
                      {visitStops.length}
                    </span>{" "}
                    visitas
                  </div>
                </div>

                {/* Stops list */}
                <div className="divide-y">
                  {day.stops.map((stop) => (
                    <div
                      key={stop.sequence}
                      className={`flex items-center gap-3 px-4 py-2.5 text-sm ${
                        stop.isHome ? "bg-blue-50/50" : ""
                      }`}
                    >
                      {/* Sequence badge */}
                      <span
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                          stop.isHome
                            ? "bg-blue-100 text-blue-600"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {stop.isHome ? "🏠" : stop.sequence}
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
