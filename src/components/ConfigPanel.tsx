"use client";

import { Config } from "@/types";
import { cn } from "@/lib/utils";

interface ConfigPanelProps {
  config: Config;
  onChange: (config: Config) => void;
  locationCount: number;
  /** Whether the map is in home-placement mode */
  placingHome?: boolean;
  /** Called to toggle home placement mode */
  onTogglePlaceHome?: () => void;
}

const CONSTRAINT_OPTIONS = [
  { value: "hours" as const, label: "Horas máximas por jornada", icon: "⏰" },
  { value: "visits" as const, label: "Visitas máximas por jornada", icon: "📍" },
  { value: "capacity" as const, label: "Capacidad del vehículo", icon: "📦" },
];

export default function ConfigPanel({
  config,
  onChange,
  locationCount,
  placingHome,
  onTogglePlaceHome,
}: ConfigPanelProps) {
  const update = (partial: Partial<Config>) => {
    onChange({ ...config, ...partial });
  };

  return (
    <div className="space-y-5">
      {/* Home coordinates */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          🏠 Coordenadas de Casa
        </label>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">
              Latitud
            </label>
            <input
              type="number"
              step="any"
              placeholder="Ej: -34.6037"
              value={config.homeLat || ""}
              onChange={(e) =>
                update({ homeLat: parseFloat(e.target.value) || 0 })
              }
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">
              Longitud
            </label>
            <input
              type="number"
              step="any"
              placeholder="Ej: -58.3816"
              value={config.homeLng || ""}
              onChange={(e) =>
                update({ homeLng: parseFloat(e.target.value) || 0 })
              }
              className="input-field"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={onTogglePlaceHome}
          className={cn(
            "w-full text-xs py-1.5 rounded-md border transition-colors",
            placingHome
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white text-gray-500 border-gray-300 hover:border-blue-400 hover:text-blue-600"
          )}
        >
          {placingHome ? "🎯 Click en el mapa..." : "📍 Colocar en el mapa"}
        </button>

        {config.homeLat !== 0 && config.homeLng !== 0 && (
          <p className="text-xs text-green-600 mt-1">
            ✓ Casa en {config.homeLat.toFixed(4)}, {config.homeLng.toFixed(4)}
          </p>
        )}
      </div>

      <hr className="border-gray-200" />

      {/* Constraint type */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Restricción diaria
        </label>
        <div className="space-y-1.5">
          {CONSTRAINT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => update({ constraintType: opt.value })}
              className={cn(
                "w-full text-left px-3 py-2 rounded-md text-sm border transition-colors",
                config.constraintType === opt.value
                  ? "border-blue-500 bg-blue-50 text-blue-700 font-medium"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              )}
            >
              <span className="mr-2">{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Constraint value — big stepper */}
      <div className="bg-gray-50 rounded-lg p-3">
        <label className="block text-xs font-medium text-gray-600 mb-2 text-center">
          {config.constraintType === "hours"
            ? "Jornada laboral"
            : config.constraintType === "visits"
            ? "Visitas por día"
            : "Capacidad del vehículo"}
        </label>
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => update({ constraintValue: Math.max(1, config.constraintValue - (config.constraintType === "hours" ? 0.5 : 1)) })}
            className="w-10 h-10 rounded-full bg-white border border-gray-300 text-gray-600 text-lg font-bold hover:bg-gray-100 flex items-center justify-center"
          >
            −
          </button>
          <div className="text-center min-w-[80px]">
            <div className="text-3xl font-bold text-gray-900">
              {config.constraintType === "hours" ? config.constraintValue.toFixed(1) : config.constraintValue}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              {config.constraintType === "hours" ? "horas" : config.constraintType === "visits" ? "paradas" : "unidades"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => update({ constraintValue: config.constraintValue + (config.constraintType === "hours" ? 0.5 : 1) })}
            className="w-10 h-10 rounded-full bg-white border border-gray-300 text-gray-600 text-lg font-bold hover:bg-gray-100 flex items-center justify-center"
          >
            +
          </button>
        </div>
        {config.constraintType === "hours" && (
          <div className="text-xs text-gray-400 mt-2 text-center">
            Incluye viaje + paradas ({config.visitTime} min c/u)
          </div>
        )}
      </div>

      {/* Speed & visit time — inline sliders for hours mode */}
      {config.constraintType === "hours" && (
        <div className="space-y-3 bg-gray-50 rounded-lg p-3">
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Velocidad</span>
              <span className="font-medium text-gray-700">{config.avgSpeed} km/h</span>
            </div>
            <input
              type="range"
              min="20"
              max="120"
              step="5"
              value={config.avgSpeed}
              onChange={(e) => update({ avgSpeed: parseInt(e.target.value) })}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-[10px] text-gray-300 mt-0.5">
              <span>20</span>
              <span>120</span>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Tiempo por parada</span>
              <span className="font-medium text-gray-700">{config.visitTime} min</span>
            </div>
            <input
              type="range"
              min="5"
              max="60"
              step="5"
              value={config.visitTime}
              onChange={(e) => update({ visitTime: parseInt(e.target.value) })}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-[10px] text-gray-300 mt-0.5">
              <span>5 min</span>
              <span>60 min</span>
            </div>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="text-xs text-gray-400 bg-gray-50 rounded-md p-2 text-center">
        {locationCount > 0
          ? `${locationCount} ubicación${locationCount !== 1 ? "es" : ""} cargada${locationCount !== 1 ? "s" : ""}`
          : "Carga ubicaciones primero"}
      </div>
    </div>
  );
}
