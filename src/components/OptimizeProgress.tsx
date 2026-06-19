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
          Matriz de distancias
        </h3>
        <p className="text-sm text-gray-400">
          Consultando Geoapify + ORS + OSRM para {totalLocations} ubicaciones...
        </p>
        <p className="text-xs text-gray-300 mt-1">
          {(totalLocations * (totalLocations - 1)) / 2} pares · 3 proveedores en paralelo
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
          {isComplete ? "✅ Matriz de distancias completa" : "🔄 Calculando rutas"}
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

      {/* Stats — solo total */}
      <div className="flex justify-center">
        <div className="bg-blue-50 rounded-lg p-3 text-center min-w-[120px]">
          <div className="text-lg font-bold text-blue-700">{p.current}</div>
          <div className="text-xs text-blue-500">de {p.total}</div>
          <div className="text-xs text-blue-400 mt-0.5">pares</div>
        </div>
      </div>
    </div>
  );
}
