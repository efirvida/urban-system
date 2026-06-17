"use client";

import { useCallback, useState, useMemo } from "react";
import {
  Location,
  Config,
  ParetoSolution,
  OptimizeResponse,
  NSGAResponse,
  RawFileData,
  ValidatedRow,
  ColumnMapping,
} from "@/types";
import { applyMapping } from "@/utils/parser";
import { cn } from "@/lib/utils";
import { buildDistanceMatrices, fetchAllRouteGeometries, MatrixProgress } from "@/utils/clientRouting";

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

  // Optimization progress
  const [optimizePhase, setOptimizePhase] = useState<"idle" | "matrix" | "algorithm" | "done" | "error">("idle");
  const [matrixProgress, setMatrixProgress] = useState<MatrixProgress | null>(null);
  const [routingMode, setRoutingMode] = useState<"osrm" | "haversine">("osrm");
  const [routeGeometry, setRouteGeometry] = useState<Map<number, [number, number][]> | null>(null);
  const [algorithm, setAlgorithm] = useState<"auto" | "nsga2">("nsga2");
  const [nsgaResult, setNsgaResult] = useState<{
    balanced: ParetoSolution;
    minDistance: ParetoSolution;
    minDuration: ParetoSolution;
  } | null>(null);
  const [selectedNsga, setSelectedNsga] = useState<"balanced" | "minDistance" | "minDuration">("balanced");

  // ── Map data (derived) ──
  const mapData = useMemo((): MapViewData => {
    const home =
      config.homeLat && config.homeLng
        ? { lat: config.homeLat, lng: config.homeLng }
        : undefined;

    if (phase === "review") {
      return { markers: validatedRows };
    }

    if (phase === "results" && result) {
      return {
        routes: result.days,
        locations,
        home,
        hiddenDays,
        routingMode,
        routeGeometry: routingMode === "osrm" ? routeGeometry ?? undefined : undefined,
      };
    }

    if (phase === "config") {
      return { locations, home };
    }

    return {};
  }, [phase, validatedRows, locations, config, result, hiddenDays, routingMode, routeGeometry]);

  /** Fetch OSRM geometry for visible days (lazy, cached) */
  const fetchGeometryForVisible = useCallback(
    (_days: any[], _hidden: Set<number>) => {
      // Geometry fetching removed to simplify — real routes shown via Google Maps link
    },
    []
  );

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
      // ── Phase 1: Build distance matrix (OSRM Table Service — 1 request!) ──
      setOptimizePhase("matrix");
      const { osrmMatrix } = await buildDistanceMatrices(
        config.homeLat, config.homeLng, locations, setMatrixProgress
      );
      const distanceObj: Record<string, number> = {};
      osrmMatrix.forEach((v, k) => { distanceObj[k] = v; });

      // ── Phase 2: Run optimizer ──
      setOptimizePhase("algorithm");
      setMatrixProgress(null);

      const res = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locations, config,
          distanceMatrix: distanceObj,
          algorithm: algorithm === "nsga2" ? "nsga2" : undefined,
        }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.details || err.error || "Error en la optimización"); }

      const data = await res.json();

      let geometryDays: Array<{ day: number; stops: Array<{ lat: number; lng: number; isHome?: boolean }> }> | undefined;

      if (data.algorithm === "nsga2") {
        const nsga = data as NSGAResponse;
        console.log("[NSGA2] balanced:", nsga.balanced.days, "d", nsga.balanced.totalDistance, "km");
        setNsgaResult({ balanced: nsga.balanced, minDistance: nsga.minDistance, minDuration: nsga.minDuration });
        setSelectedNsga("balanced");
        setResult({ days: nsga.balanced.dayRoutes, totalDistance: nsga.balanced.totalDistance, totalDays: nsga.balanced.days, totalLocations: locations.length });
        setHiddenDays(new Set(nsga.balanced.dayRoutes.slice(1).map((d) => d.day)));
        geometryDays = nsga.balanced.dayRoutes;
      } else {
        const optResult = data as OptimizeResponse;
        setResult(optResult);
        setNsgaResult(null);
        setHiddenDays(new Set(optResult.days.slice(1).map((d: any) => d.day)));
        geometryDays = optResult.days;
      }

      // Fetch route geometries for map visualization (road-following polylines)
      if (geometryDays && geometryDays.length > 0) {
        fetchAllRouteGeometries(geometryDays).then(geo => {
          if (geo.size > 0) setRouteGeometry(geo);
        });
      }
      setRoutingMode("osrm");
      setOptimizePhase("done");

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
                  <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-1 border">
                    <button onClick={() => setAlgorithm("auto")} className={cn("flex-1 text-xs py-1.5 px-2 rounded-md font-medium transition-colors", algorithm === "auto" ? "bg-white text-blue-700 shadow-sm border" : "text-gray-500 hover:text-gray-700")}>🧠 Auto</button>
                    <button onClick={() => setAlgorithm("nsga2")} className={cn("flex-1 text-xs py-1.5 px-2 rounded-md font-medium transition-colors", algorithm === "nsga2" ? "bg-white text-blue-700 shadow-sm border" : "text-gray-500 hover:text-gray-700")}>🧬 NSGA-II</button>
                  </div>
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
        return result ? (
          <>
            {stepsNode}
            <div className="mt-3 space-y-3">
              {nsgaResult && (
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-3">
                  <div className="text-xs font-semibold text-blue-700 mb-2">🧬 NSGA-II — {selectedNsga === "balanced" ? "⚖️ Balanceada" : selectedNsga === "minDistance" ? "📏 Min distancia" : "⏱️ Min duración"}</div>
                  <div className="flex flex-col gap-1">
                    {(["balanced", "minDistance", "minDuration"] as const).map((mode) => {
                      const sol = nsgaResult[mode];
                      const labels = { balanced: "⚖️ Balanceada", minDistance: "📏 Menos km", minDuration: "⏱️ Día +corto" };
                      return (
                        <button key={mode} onClick={() => { setSelectedNsga(mode); setResult({ days: sol.dayRoutes, totalDistance: sol.totalDistance, totalDays: sol.days, totalLocations: locations.length }); setHiddenDays(new Set(sol.dayRoutes.slice(1).map(d => d.day))); }}
                          className={cn("flex items-center justify-between w-full text-left px-3 py-2 rounded-md text-sm transition-all", selectedNsga === mode ? "bg-white text-blue-800 shadow-sm border border-blue-300 font-medium" : "text-gray-600 hover:bg-white/70")}>
                          <span>{labels[mode]}</span>
                          <span className="text-xs font-mono text-blue-500">{sol.days}d · {sol.totalDistance.toFixed(0)}km · {sol.maxDayHours.toFixed(1)}h/día</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <ResultsPanel
                days={result.days}
                totalDistance={result.totalDistance}
                totalDays={result.totalDays}
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
                    const allDays = result.days.map((d) => d.day);
                    return new Set(allDays.filter((d) => d !== day));
                  })
                }
                routingLabel="🚗 Rutas optimizadas"
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
        ) : null;

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
