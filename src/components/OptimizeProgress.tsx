"use client";

import { MatrixProgress } from "@/utils/clientRouting";

interface OptimizeProgressProps {
  progress: MatrixProgress | null;
  phase: "matrix" | "algorithm" | "done" | "error";
  totalLocations: number;
  error?: string;
}

export default function OptimizeProgress({
  progress,
  phase,
  totalLocations,
  error,
}: OptimizeProgressProps) {
  // ── Error ──
  if (phase === "error") {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
          <span className="text-2xl">❌</span>
        </div>
        <h3 className="text-lg font-semibold text-red-700 mb-2">
          Error en la optimización
        </h3>
        <p className="text-sm text-gray-500 max-w-sm">{error}</p>
      </div>
    );
  }

  // ── Done ──
  if (phase === "done") {
    return null; // Let the results panel take over
  }

  // ── Running algorithm (fast, no progress) ──
  if (phase === "algorithm") {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mb-4">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
        <h3 className="text-lg font-semibold text-gray-800 mb-2">
          Ejecutando algoritmo...
        </h3>
        <p className="text-sm text-gray-400">
          Ordenando rutas con Clarke & Wright
        </p>
      </div>
    );
  }

  // ── Matrix computation ──
  const p = progress;
  if (!p) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mb-4">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
        <h3 className="text-lg font-semibold text-gray-800 mb-2">
          Preparando optimización...
        </h3>
        <p className="text-sm text-gray-400">
          Calculando matriz de distancias para {totalLocations} ubicaciones
        </p>
      </div>
    );
  }

  const isComplete = p.percent >= 100;
  const etaText =
    p.etaSeconds > 120
      ? `${Math.round(p.etaSeconds / 60)} min`
      : p.etaSeconds > 0
      ? `${p.etaSeconds} seg`
      : "calculando...";

  return (
    <div className="py-6">
      <div className="text-center mb-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-1">
          {isComplete ? "✅ Matriz de distancias completa" : "🔄 Consultando rutas reales"}
        </h3>
        <p className="text-sm text-gray-400">
          {p.stage}
        </p>
      </div>

      {/* Big progress circle */}
      <div className="flex justify-center mb-6">
        <div className="relative w-32 h-32">
          {/* Background circle */}
          <svg className="w-32 h-32 -rotate-90" viewBox="0 0 128 128">
            <circle
              cx="64"
              cy="64"
              r="56"
              fill="none"
              stroke="#e5e7eb"
              strokeWidth="10"
            />
            <circle
              cx="64"
              cy="64"
              r="56"
              fill="none"
              stroke="#3b82f6"
              strokeWidth="10"
              strokeDasharray={2 * Math.PI * 56}
              strokeDashoffset={2 * Math.PI * 56 * (1 - p.percent / 100)}
              strokeLinecap="round"
              className="transition-all duration-500 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl font-bold text-blue-600">
              {p.percent}%
            </span>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 max-w-xs mx-auto mb-6">
        <div className="bg-blue-50 rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-blue-700">{p.current}</div>
          <div className="text-xs text-blue-500">de {p.total}</div>
          <div className="text-xs text-blue-400 mt-0.5">pares calculados</div>
        </div>
        <div className="bg-green-50 rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-green-700">{p.realCount}</div>
          <div className="text-xs text-green-500">rutas reales</div>
          <div className="text-xs text-green-400 mt-0.5">(OSRM)</div>
        </div>
        <div className="bg-amber-50 rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-amber-700">{p.haversineCount}</div>
          <div className="text-xs text-amber-500">estimadas</div>
          <div className="text-xs text-amber-400 mt-0.5">(Haversine)</div>
        </div>
        <div className="bg-purple-50 rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-purple-700">{etaText}</div>
          <div className="text-xs text-purple-500">tiempo restante</div>
          <div className="text-xs text-purple-400 mt-0.5">estimado</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2.5 max-w-sm mx-auto">
        <div
          className="bg-blue-600 h-2.5 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${p.percent}%` }}
        />
      </div>

      {/* Small print */}
      <p className="text-center text-xs text-gray-400 mt-4">
        Consultando Open Source Routing Machine (OSRM) para distancias reales por ruta.
        Los pares sin cobertura se estiman con distancia Haversine.
      </p>
    </div>
  );
}
