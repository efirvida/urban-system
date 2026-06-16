"use client";

import { Config } from "@/types";
import { cn } from "@/lib/utils";

interface ConfigPanelProps {
  config: Config;
  onChange: (config: Config) => void;
  locationCount: number;
}

const CONSTRAINT_OPTIONS = [
  { value: "hours", label: "Horas máximas por jornada", icon: "⏰" },
  { value: "visits", label: "Visitas máximas por jornada", icon: "📍" },
  { value: "capacity", label: "Capacidad del vehículo", icon: "📦" },
] as const;

export default function ConfigPanel({
  config,
  onChange,
  locationCount,
}: ConfigPanelProps) {
  const update = (partial: Partial<Config>) => {
    onChange({ ...config, ...partial });
  };

  return (
    <div className="card-base">
      <div className="card-header">⚙️ Configuración</div>
      <div className="card-body space-y-5">
        {/* Home coordinates */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            🏠 Coordenadas de Casa
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">
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
              <label className="block text-xs text-gray-500 mb-1">
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
        </div>

        <hr className="border-gray-200" />

        {/* Constraint type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Restricción diaria
          </label>
          <div className="space-y-2">
            {CONSTRAINT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() =>
                  update({ constraintType: opt.value as Config["constraintType"] })
                }
                className={cn(
                  "w-full text-left px-3 py-2.5 rounded-md text-sm border transition-colors",
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
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {config.constraintType === "hours"
              ? "Horas por jornada"
              : config.constraintType === "visits"
              ? "Número máximo de visitas"
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
              Incluye tiempo de viaje + {config.visitTime} min por visita
            </p>
          )}
        </div>

        {/* Extra config for hours constraint */}
        {config.constraintType === "hours" && (
          <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-md">
            <div>
              <label className="block text-xs text-gray-500 mb-1">
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
              <label className="block text-xs text-gray-500 mb-1">
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

        {/* Summary */}
        <div className="text-xs text-gray-400 bg-gray-50 rounded-md p-2">
          {locationCount > 0 ? (
            <span>
              {locationCount} ubicación{locationCount !== 1 ? "es" : ""} cargada
             {locationCount !== 1 ? "s" : ""}
            </span>
          ) : (
            <span>Carga un archivo primero</span>
          )}
        </div>
      </div>
    </div>
  );
}
