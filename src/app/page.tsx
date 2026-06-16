"use client";

import { useCallback, useState, useMemo } from "react";
import {
  Location,
  Config,
  OptimizeResponse,
  RawFileData,
  ValidatedRow,
  ColumnMapping,
} from "@/types";
import { applyMapping } from "@/utils/parser";
import { cn } from "@/lib/utils";
import { buildDistanceMatrices, MatrixProgress } from "@/utils/clientRouting";

import FileUpload from "@/components/FileUpload";
import ColumnMapper from "@/components/ColumnMapper";
import DataEditor from "@/components/DataEditor";
import ConfigPanel from "@/components/ConfigPanel";
import ResultsPanel from "@/components/ResultsPanel";
import OptimizeButton from "@/components/OptimizeButton";
import OptimizeProgress from "@/components/OptimizeProgress";
import MapView, { MapViewData } from "@/components/MapView";
import Sidebar from "@/components/Sidebar";

// ─── Phase definition ───────────────────────────────────────

const PHASES = [
  { key: "upload", label: "Cargar", short: "📂" },
  { key: "mapping", label: "Columnas", short: "📋" },
  { key: "review", label: "Revisar", short: "✏️" },
  { key: "config", label: "Configurar", short: "⚙️" },
  { key: "results", label: "Resultados", short: "✅" },
] as const;

type PhaseKey = (typeof PHASES)[number]["key"];

// ─── Component ──────────────────────────────────────────────

export default function Home() {
  // ── Navigation ──
  const [phase, setPhase] = useState<PhaseKey>("upload");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const currentIdx = PHASES.findIndex((p) => p.key === phase);

  // ── Data ──
  const [rawData, setRawData] = useState<RawFileData | null>(null);
  const [validatedRows, setValidatedRows] = useState<ValidatedRow[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  const [config, setConfig] = useState<Config>({
    homeLat: 0,
    homeLng: 0,
    constraintType: "hours",
    constraintValue: 8,
    avgSpeed: 60,
    visitTime: 30,
  });
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [placementMode, setPlacementMode] = useState<"home" | null>(null);
  const [hiddenDays, setHiddenDays] = useState<Set<number>>(new Set());

  // Optimization progress & dual results
  const [optimizePhase, setOptimizePhase] = useState<"idle" | "matrix" | "algorithm" | "done" | "error">("idle");
  const [matrixProgress, setMatrixProgress] = useState<MatrixProgress | null>(null);
  const [resultHaversine, setResultHaversine] = useState<OptimizeResponse | null>(null);
  /** "osrm" = real roads, "haversine" = straight lines */
  const [routingMode, setRoutingMode] = useState<"osrm" | "haversine">("osrm");

  // ── Map data (derived) ──
  const mapData = useMemo((): MapViewData => {
    const home =
      config.homeLat && config.homeLng
        ? { lat: config.homeLat, lng: config.homeLng }
        : undefined;

    if (phase === "review") {
      return { markers: validatedRows };
    }

    if (phase === "results" && (result || resultHaversine)) {
      const activeResult = routingMode === "osrm" ? result : resultHaversine;
      return {
        routes: activeResult?.days,
        locations,
        home,
        hiddenDays,
        routingMode,
      };
    }

    if (phase === "config") {
      return { locations, home };
    }

    return {};
  }, [phase, validatedRows, locations, config, result, resultHaversine, hiddenDays, routingMode]);

  // ── Handlers ──
  const handleFileLoaded = useCallback((data: RawFileData) => {
    setRawData(data);
    setError(null);
    setPhase("mapping");
    setSidebarOpen(true);
  }, []);

  const handleMappingConfirm = useCallback(
    (mapping: ColumnMapping, dataRows: Record<string, unknown>[]) => {
      try {
        const rows = applyMapping(dataRows, mapping);
        setValidatedRows(rows);
        setError(null);
        setPhase("review");
        setSidebarOpen(true);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Error al aplicar el mapeo"
        );
      }
    },
    []
  );

  const handleRowsChange = useCallback((rows: ValidatedRow[]) => {
    setValidatedRows(rows);
  }, []);

  const handleReviewConfirm = useCallback((locs: Location[]) => {
    setLocations(locs);
    setError(null);
    setPhase("config");
    setSidebarOpen(true);
  }, []);

  const handleOptimize = useCallback(async () => {
    if (locations.length === 0) {
      setError("No hay ubicaciones válidas.");
      return;
    }
    if (!config.homeLat || !config.homeLng) {
      setError("Configura las coordenadas de la casa.");
      return;
    }

    setLoading(true);
    setError(null);
    setOptimizePhase("matrix");
    setMatrixProgress(null);

    try {
      // ── Phase 1: Build distance matrices (client-side) ──
      setOptimizePhase("matrix");
      const { osrmMatrix, haversineMatrix } = await buildDistanceMatrices(
        config.homeLat,
        config.homeLng,
        locations,
        setMatrixProgress
      );

      // Convert Maps to plain objects for JSON serialization
      const osrmObj: Record<string, number> = {};
      osrmMatrix.forEach((v, k) => { osrmObj[k] = v; });
      const havObj: Record<string, number> = {};
      haversineMatrix.forEach((v, k) => { havObj[k] = v; });

      // ── Phase 2: Run algorithm with OSRM matrix ──
      setOptimizePhase("algorithm");
      setMatrixProgress(null);

      const resOSRM = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locations, config, distanceMatrix: osrmObj }),
      });

      // Run algorithm with Haversine matrix
      const resHav = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locations, config, distanceMatrix: havObj }),
      });

      if (!resOSRM.ok) {
        const err = await resOSRM.json();
        throw new Error(err.error || "Error en la optimización");
      }

      const osrmResult: OptimizeResponse = await resOSRM.json();
      const havResult: OptimizeResponse = await resHav.json();

      setResult(osrmResult);
      setResultHaversine(havResult);
      setRoutingMode("osrm");
      setOptimizePhase("done");
      // Show only Day 1 on the map by default
      setHiddenDays(
        new Set(
          osrmResult.days.slice(1).map((d) => d.day)
        )
      );
      setPhase("results");
      setSidebarOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
      setOptimizePhase("error");
    } finally {
      setLoading(false);
    }
  }, [locations, config]);

  const handlePlaceHome = useCallback(
    (lat: number, lng: number) => {
      setConfig((prev) => ({ ...prev, homeLat: lat, homeLng: lng }));
      setPlacementMode(null); // exit placement mode after placing
    },
    []
  );

  const handleDragHome = useCallback(
    (lat: number, lng: number) => {
      setConfig((prev) => ({ ...prev, homeLat: lat, homeLng: lng }));
    },
    []
  );

  const handleTogglePlaceHome = useCallback(() => {
    setPlacementMode((prev) => (prev === "home" ? null : "home"));
  }, []);

  const handleReset = useCallback(() => {
    setRawData(null);
    setValidatedRows([]);
    setLocations([]);
    setResult(null);
    setError(null);
    setPhase("upload");
    setSidebarOpen(true);
    setPlacementMode(null);
    setHiddenDays(new Set());
  }, []);

  // ── Steps bar — shown inside the sidebar header ──
  const stepsNode = (
    <div className="flex items-center gap-1.5 flex-wrap">
      {PHASES.map((p, i) => {
        const isActive = i === currentIdx;
        const isPast = i < currentIdx;
        return (
          <span
            key={p.key}
            className={cn(
              "text-xs px-2 py-0.5 rounded-full transition-colors",
              isActive
                ? "bg-blue-600 text-white font-medium"
                : isPast
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-400"
            )}
          >
            {p.short} {p.label}
          </span>
        );
      })}
    </div>
  );

  // ── Sidebar content per phase ──
  const sidebarTitle = PHASES[currentIdx]?.label ?? "";
  const sidebarSubtitle =
    phase === "review"
      ? `${validatedRows.filter((r) => r.selected && r.isValid).length} de ${validatedRows.length} seleccionadas`
      : phase === "config"
      ? `${locations.length} ubicaciones`
      : phase === "results" && result
      ? `${result.totalDays} días · ${result.totalDistance.toFixed(0)} km`
      : undefined;

  const sidebarContent = (() => {
    switch (phase) {
      case "upload":
        return (
          <div className="pt-8">
            <FileUpload onFileLoaded={handleFileLoaded} />
          </div>
        );

      case "mapping":
        return rawData ? (
          <ColumnMapper
            data={rawData}
            onConfirm={handleMappingConfirm}
            onBack={() => setPhase("upload")}
          />
        ) : null;

      case "review":
        return (
          <>
            {stepsNode}
            <div className="mt-3">
              <DataEditor
                rows={validatedRows}
                onChange={handleRowsChange}
                onConfirm={handleReviewConfirm}
                onBack={() => setPhase("mapping")}
              />
            </div>
          </>
        );

      case "config":
        return (
          <>
            {stepsNode}
            <div className="mt-3 space-y-4">
              {optimizePhase === "idle" || optimizePhase === "done" ? (
                <>
                  <ConfigPanel
                    config={config}
                    onChange={setConfig}
                    locationCount={locations.length}
                    placingHome={placementMode === "home"}
                    onTogglePlaceHome={handleTogglePlaceHome}
                  />
                  <OptimizeButton
                    onClick={handleOptimize}
                    loading={loading}
                    disabled={locations.length === 0}
                  />
                  <button
                    onClick={() => setPhase("review")}
                    className="btn-secondary w-full text-sm"
                  >
                    ← Volver a editar ubicaciones
                  </button>
                </>
              ) : (
                <OptimizeProgress
                  progress={matrixProgress}
                  phase={optimizePhase === "algorithm" ? "algorithm" : "matrix"}
                  totalLocations={locations.length}
                  error={error ?? undefined}
                />
              )}
            </div>
          </>
        );

      case "results":
        return result ? (() => {
          const activeResult = routingMode === "osrm" ? result : resultHaversine;
          const activeDays = activeResult?.days ?? result.days;
          const activeDistance = activeResult?.totalDistance ?? result.totalDistance;
          const activeDaysCount = activeResult?.totalDays ?? result.totalDays;
          const osrmMeta = result._meta;
          const hasRealRoutes = (osrmMeta?.osrmPairs ?? 0) > 0;
          const havDays = resultHaversine?.days.length ?? 0;
          const diffClusters = hasRealRoutes && result.days.length !== havDays;

          return (
            <>
              {stepsNode}
              <div className="mt-3 space-y-3">
                {/* Routing mode toggle */}
                {resultHaversine && hasRealRoutes && (
                  <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-1 border">
                    <button
                      onClick={() => setRoutingMode("osrm")}
                      className={cn(
                        "flex-1 text-xs py-1.5 px-3 rounded-md font-medium transition-colors",
                        routingMode === "osrm"
                          ? "bg-white text-blue-700 shadow-sm border"
                          : "text-gray-500 hover:text-gray-700"
                      )}
                    >
                      🚗 Ruta real
                    </button>
                    <button
                      onClick={() => setRoutingMode("haversine")}
                      className={cn(
                        "flex-1 text-xs py-1.5 px-3 rounded-md font-medium transition-colors",
                        routingMode === "haversine"
                          ? "bg-white text-blue-700 shadow-sm border"
                          : "text-gray-500 hover:text-gray-700"
                      )}
                    >
                      📏 Línea recta
                    </button>
                  </div>
                )}

                {!hasRealRoutes && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-700 text-center">
                    ⚠️ OSRM no disponible — usando distancias estimadas (Haversine)
                  </div>
                )}

                {diffClusters && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 text-xs text-blue-700 text-center">
                    📊 Ruta real: {result.days.length} días · Línea recta: {havDays} días
                  </div>
                )}

                <ResultsPanel
                  days={activeDays}
                  totalDistance={activeDistance}
                  totalDays={activeDaysCount}
                  totalLocations={result.totalLocations}
                  hiddenDays={hiddenDays}
                  onToggleDay={(day) =>
                    setHiddenDays((prev) => {
                      const next = new Set(prev);
                      if (next.has(day)) next.delete(day);
                      else next.add(day);
                      return next;
                    })
                  }
                  onExpandDay={(day) =>
                    setHiddenDays((prev) => {
                      const allDays = activeDays.map((d) => d.day);
                      return new Set(allDays.filter((d) => d !== day));
                    })
                  }
                  routingLabel={routingMode === "osrm" ? "🚗 Rutas reales" : "📏 Línea recta"}
                />

                <button
                  onClick={() => setHiddenDays(new Set())}
                  className="w-full text-xs text-center text-gray-400 hover:text-blue-600 transition-colors py-1"
                >
                  👁 Ver todas las rutas en el mapa
                </button>

                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setPhase("config")}
                    className="btn-secondary w-full text-sm"
                  >
                    ← Volver a configuración
                  </button>
                  <button
                    onClick={handleReset}
                    className="btn-secondary w-full text-sm"
                  >
                    🆕 Nueva optimización
                  </button>
                </div>
              </div>
            </>
          );
        })() : null;

      default:
        return null;
    }
  })();

  // ── Render ──
  return (
    <div className="h-screen w-screen overflow-hidden relative bg-gray-100">
      {/* ── Full-screen map ── */}
      <MapView
        data={mapData}
        placementMode={placementMode}
        onPlaceHome={handlePlaceHome}
        onDragHome={handleDragHome}
      />

      {/* ── Error toast ── */}
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-50 border border-red-200 rounded-lg shadow-lg text-sm text-red-700 max-w-md">
          <span className="font-medium">Error:</span> {error}
          <button
            onClick={() => setError(null)}
            className="ml-3 text-red-400 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Sidebar ── */}
      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((o) => !o)}
        title={`🚚 ${sidebarTitle}`}
        subtitle={sidebarSubtitle}
      >
        {/* New optimization button at top when not in upload */}
        {phase !== "upload" && (
          <button
            onClick={handleReset}
            className="text-xs text-gray-400 hover:text-blue-600 transition-colors mb-3 block"
          >
            ← Nueva optimización
          </button>
        )}

        {sidebarContent}
      </Sidebar>
    </div>
  );
}
