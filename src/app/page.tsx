"use client";

import { useCallback, useState, useMemo } from "react";
import { Location, Config, OptimizeResponse, RawFileData, ValidatedRow, ColumnMapping } from "@/types";
import { applyMapping, validatedToLocations } from "@/utils/parser";
import FileUpload from "@/components/FileUpload";
import ColumnMapper from "@/components/ColumnMapper";
import DataEditor from "@/components/DataEditor";
import ConfigPanel from "@/components/ConfigPanel";
import ResultsPanel from "@/components/ResultsPanel";
import RouteMap from "@/components/RouteMap";
import OptimizeButton from "@/components/OptimizeButton";

type PageState = "upload" | "mapping" | "review" | "config" | "results";

export default function Home() {
  const [pageState, setPageState] = useState<PageState>("upload");

  // Raw file data after upload
  const [rawData, setRawData] = useState<RawFileData | null>(null);

  // Validated rows after column mapping
  const [validatedRows, setValidatedRows] = useState<ValidatedRow[]>([]);

  // Final locations after user review
  const [locations, setLocations] = useState<Location[]>([]);

  // Config + results
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

  // ─── Handlers ──────────────────────────────────────────────

  const handleFileLoaded = useCallback((data: RawFileData) => {
    setRawData(data);
    setError(null);
    setPageState("mapping");
  }, []);

  const handleMappingConfirm = useCallback(
    (mapping: ColumnMapping) => {
      if (!rawData) return;
      try {
        const rows = applyMapping(rawData.rows, mapping);
        setValidatedRows(rows);
        setError(null);
        setPageState("review");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Error al aplicar el mapeo"
        );
      }
    },
    [rawData]
  );

  const handleRowsChange = useCallback((rows: ValidatedRow[]) => {
    setValidatedRows(rows);
  }, []);

  const handleReviewConfirm = useCallback((locs: Location[]) => {
    setLocations(locs);
    setError(null);
    setPageState("config");
  }, []);

  const handleOptimize = useCallback(async () => {
    if (locations.length === 0) {
      setError("No hay ubicaciones válidas para optimizar.");
      return;
    }

    if (!config.homeLat || !config.homeLng) {
      setError("Configura las coordenadas de la casa.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locations, config }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Error en la optimización");
      }

      const data: OptimizeResponse = await res.json();
      setResult(data);
      setPageState("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setLoading(false);
    }
  }, [locations, config]);

  const handleReset = useCallback(() => {
    setRawData(null);
    setValidatedRows([]);
    setLocations([]);
    setResult(null);
    setError(null);
    setPageState("upload");
  }, []);

  // ─── Steps indicator ───────────────────────────────────────

  const steps = [
    { key: "upload", label: "Cargar" },
    { key: "mapping", label: "Columnas" },
    { key: "review", label: "Revisar" },
    { key: "config", label: "Configurar" },
    { key: "results", label: "Resultados" },
  ] as const;

  const currentStepIdx = steps.findIndex((s) => s.key === pageState);

  // ─── Render ────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="border-b bg-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">
              🚚 Optimizador de Rutas VRP
            </h1>
            <p className="text-xs text-gray-500">
              Multi-Trip Vehicle Routing Problem — optimización diaria
            </p>
          </div>
          {pageState !== "upload" && (
            <button onClick={handleReset} className="btn-secondary text-xs">
              Nueva optimización
            </button>
          )}
        </div>

        {/* Steps bar */}
        <div className="border-t px-4">
          <div className="max-w-3xl mx-auto flex items-center justify-between py-2">
            {steps.map((step, i) => {
              const isActive = i === currentStepIdx;
              const isPast = i < currentStepIdx;
              return (
                <div key={step.key} className="flex items-center gap-1.5">
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      isActive
                        ? "bg-blue-600 text-white"
                        : isPast
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {isPast ? "✓" : i + 1}
                  </span>
                  <span
                    className={`text-xs hidden sm:inline ${
                      isActive
                        ? "text-blue-600 font-medium"
                        : isPast
                        ? "text-green-600"
                        : "text-gray-400"
                    }`}
                  >
                    {step.label}
                  </span>
                  {i < steps.length - 1 && (
                    <span className="text-gray-300 text-xs mx-1 hidden sm:inline">
                      →
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {/* Error banner */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <span className="font-medium">Error:</span> {error}
          </div>
        )}

        {/* Phase: Upload */}
        {pageState === "upload" && (
          <div className="max-w-xl mx-auto mt-8">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Carga tus ubicaciones
              </h2>
              <p className="text-sm text-gray-500">
                Subí un archivo .ods o .xlsx con tus ubicaciones
              </p>
            </div>
            <FileUpload onFileLoaded={handleFileLoaded} />
          </div>
        )}

        {/* Phase: Column Mapping */}
        {pageState === "mapping" && rawData && (
          <ColumnMapper
            data={rawData}
            onConfirm={handleMappingConfirm}
            onBack={() => setPageState("upload")}
          />
        )}

        {/* Phase: Review & Edit */}
        {pageState === "review" && (
          <DataEditor
            rows={validatedRows}
            onChange={handleRowsChange}
            onConfirm={handleReviewConfirm}
            onBack={() => setPageState("mapping")}
          />
        )}

        {/* Phase: Config */}
        {pageState === "config" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1">
              <ConfigPanel
                config={config}
                onChange={setConfig}
                locationCount={locations.length}
              />
              <div className="mt-4">
                <OptimizeButton
                  onClick={handleOptimize}
                  loading={loading}
                  disabled={locations.length === 0}
                />
              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="card-base">
                <div className="card-header">
                  Ubicaciones confirmadas ({locations.length})
                </div>
                <div className="card-body max-h-[500px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-500">
                        <th className="pb-2 font-medium">#</th>
                        <th className="pb-2 font-medium">Nombre</th>
                        <th className="pb-2 font-medium">Latitud</th>
                        <th className="pb-2 font-medium">Longitud</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locations.map((loc, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-2 text-gray-400">{i + 1}</td>
                          <td className="py-2 font-medium">{loc.name}</td>
                          <td className="py-2 text-gray-600 font-mono text-xs">
                            {loc.lat.toFixed(6)}
                          </td>
                          <td className="py-2 text-gray-600 font-mono text-xs">
                            {loc.lng.toFixed(6)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <button
                onClick={() => setPageState("review")}
                className="btn-secondary mt-3 text-sm"
              >
                ← Volver a editar ubicaciones
              </button>
            </div>
          </div>
        )}

        {/* Phase: Results */}
        {pageState === "results" && result && (
          <div className="split-layout" style={{ minHeight: "70vh" }}>
            <div className="overflow-y-auto">
              <ResultsPanel
                days={result.days}
                totalDistance={result.totalDistance}
                totalDays={result.totalDays}
                totalLocations={result.totalLocations}
              />
            </div>
            <div className="card-base overflow-hidden">
              <div className="card-header">Mapa de Rutas</div>
              <div className="card-body p-0">
                <RouteMap days={result.days} config={config} />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t bg-white py-3 text-center text-xs text-gray-400">
        VRP Optimizer — Next.js + Maplibre GL
      </footer>
    </div>
  );
}
