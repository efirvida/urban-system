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

      {/* Constraint value */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {config.constraintType === "hours"
            ? "Horas por jornada"
            : config.constraintType === "visits"
            ? "Máximo de visitas"
            : "Capacidad máxima"}
        </label>
        <input
          type="number"
          min="1"
          step={config.constraintType === "hours" ? "0.5" : "1"}
          value={config.constraintValue}
          onChange={(e) =>
            update({ constraintValue: parseFloat(e.target.value) || 1 })
          }
          className="input-field"
        />
        {config.constraintType === "hours" && (
          <p className="text-xs text-gray-400 mt-1">
            Incluye viaje + {config.visitTime} min por visita
          </p>
        )}
      </div>

      {/* Speed & visit time (only for hours) */}
      {config.constraintType === "hours" && (
        <div className="grid grid-cols-2 gap-2 p-3 bg-gray-50 rounded-md">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">
              Velocidad (km/h)
            </label>
            <input
              type="number"
              min="1"
              value={config.avgSpeed}
              onChange={(e) =>
                update({ avgSpeed: parseFloat(e.target.value) || 60 })
              }
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">
              Tiempo visita (min)
            </label>
            <input
              type="number"
              min="1"
              value={config.visitTime}
              onChange={(e) =>
                update({ visitTime: parseFloat(e.target.value) || 30 })
              }
              className="input-field"
            />
          </div>
        </div>
      )}

      {/* Google Maps API Key */}
      <hr className="border-gray-200" />
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          🗺️ Google Maps API Key
        </label>
        <input
          type="text"
          placeholder="AIzaSy... (opcional)"
          value={config.googleMapsKey || ""}
          onChange={(e) => update({ googleMapsKey: e.target.value })}
          className="input-field font-mono text-xs"
        />
        <p className="text-xs text-gray-400 mt-1">
          Si no se provee, usa OSRM + Haversine. 
          Google Maps Distance Matrix API tiene crédito gratuito de $200/mes.
        </p>
      </div>

      {/* Summary */}
      <div className="text-xs text-gray-400 bg-gray-50 rounded-md p-2 text-center">
        {locationCount > 0
          ? `${locationCount} ubicación${locationCount !== 1 ? "es" : ""} cargada${locationCount !== 1 ? "s" : ""}`
          : "Carga ubicaciones primero"}
      </div>
    </div>
  );
}
