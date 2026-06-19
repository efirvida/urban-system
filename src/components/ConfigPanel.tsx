"use client";

import { Clock, MapPin, Zap, Home, Crosshair, Check, Minus, Plus } from "lucide-react";
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

const CONSTRAINT_OPTIONS: { value: Config["constraintType"]; label: string; Icon: typeof Clock }[] = [
  { value: "hours", label: "Horas máximas por jornada", Icon: Clock },
  { value: "visits", label: "Visitas máximas por jornada", Icon: MapPin },
  { value: "hours+visits", label: "Horas + Visitas máximas", Icon: Zap },
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
        <label className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
          <Home className="w-4 h-4" />
          Coordenadas de Casa
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
          aria-label={placingHome ? "Cancelar colocación en mapa" : "Colocar casa en el mapa"}
          className={cn(
            "w-full text-xs py-1.5 rounded-md border transition-colors inline-flex items-center justify-center gap-1.5",
            placingHome
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white text-gray-500 border-gray-300 hover:border-blue-400 hover:text-blue-600"
          )}
        >
          {placingHome ? (
            <>
              <Crosshair className="w-3.5 h-3.5" />
              Click en el mapa...
            </>
          ) : (
            <>
              <MapPin className="w-3.5 h-3.5" />
              Colocar en el mapa
            </>
          )}
        </button>

        {config.homeLat !== 0 && config.homeLng !== 0 && (
          <p className="text-xs text-green-600 mt-1 inline-flex items-center gap-1">
            <Check className="w-3 h-3" />
            Casa en {config.homeLat.toFixed(4)}, {config.homeLng.toFixed(4)}
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
          {CONSTRAINT_OPTIONS.map((opt) => {
            const Icon = opt.Icon;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => update({ constraintType: opt.value })}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-md text-sm border transition-colors inline-flex items-center",
                  config.constraintType === opt.value
                    ? "border-blue-500 bg-blue-50 text-blue-700 font-medium"
                    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                )}
              >
                <Icon className="w-3.5 h-3.5 mr-2 shrink-0" />
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Constraint value(s) — stepper */}
      <div className="bg-gray-50 rounded-lg p-3 space-y-3">
        {config.constraintType === "hours+visits" ? (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2 text-center">Jornada laboral</label>
              <div className="flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => update({ constraintValue: Math.max(1, config.constraintValue - 0.5) })}
                  aria-label="Disminuir horas"
                  className="w-10 h-10 rounded-full bg-white border border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center transition-colors"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <div className="text-center min-w-[80px]">
                  <div className="text-3xl font-bold text-gray-900">{config.constraintValue.toFixed(1)}</div>
                  <div className="text-xs text-gray-400 mt-0.5">horas</div>
                </div>
                <button
                  type="button"
                  onClick={() => update({ constraintValue: config.constraintValue + 0.5 })}
                  aria-label="Aumentar horas"
                  className="w-10 h-10 rounded-full bg-white border border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
            <hr className="border-gray-200" />
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2 text-center">Visitas máximas por jornada</label>
              <div className="flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => update({ maxVisits: Math.max(1, (config.maxVisits ?? 10) - 1) })}
                  aria-label="Disminuir visitas"
                  className="w-10 h-10 rounded-full bg-white border border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center transition-colors"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <div className="text-center min-w-[80px]">
                  <div className="text-3xl font-bold text-gray-900">{config.maxVisits ?? 10}</div>
                  <div className="text-xs text-gray-400 mt-0.5">paradas</div>
                </div>
                <button
                  type="button"
                  onClick={() => update({ maxVisits: (config.maxVisits ?? 10) + 1 })}
                  aria-label="Aumentar visitas"
                  className="w-10 h-10 rounded-full bg-white border border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <label className="block text-xs font-medium text-gray-600 mb-2 text-center">
              {config.constraintType === "hours" ? "Jornada laboral" : "Visitas por día"}
            </label>
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => update({ constraintValue: Math.max(1, config.constraintValue - (config.constraintType === "hours" ? 0.5 : 1)) })}
                aria-label={config.constraintType === "hours" ? "Disminuir horas" : "Disminuir visitas"}
                className="w-10 h-10 rounded-full bg-white border border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              <div className="text-center min-w-[80px]">
                <div className="text-3xl font-bold text-gray-900">{config.constraintType === "hours" ? config.constraintValue.toFixed(1) : config.constraintValue}</div>
                <div className="text-xs text-gray-400 mt-0.5">{config.constraintType === "hours" ? "horas" : "paradas"}</div>
              </div>
              <button
                type="button"
                onClick={() => update({ constraintValue: config.constraintValue + (config.constraintType === "hours" ? 0.5 : 1) })}
                aria-label={config.constraintType === "hours" ? "Aumentar horas" : "Aumentar visitas"}
                className="w-10 h-10 rounded-full bg-white border border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {config.constraintType === "hours" && (
              <div className="text-xs text-gray-400 mt-2 text-center">Incluye viaje + {(config.visitTime / 60).toFixed(1)}h por parada</div>
            )}
          </>
        )}
      </div>

      {/* Speed & visit time — sliders, always visible for all modes */}
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
          {config.constraintType === "hours" && (
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Tiempo por parada</span>
              <span className="font-medium text-gray-700">{(config.visitTime / 60).toFixed(1)} h</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="3"
              step="0.1"
              value={config.visitTime / 60}
              onChange={(e) => update({ visitTime: Math.round(parseFloat(e.target.value) * 60) })}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-[10px] text-gray-300 mt-0.5">
              <span>0.1 h</span>
              <span>3 h</span>
            </div>
          </div>
          )}
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
