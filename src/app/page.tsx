"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  ClipboardList,
  Pencil,
  Settings,
  CheckCheck,
  Truck,
  Eye,
  PlusCircle,
  FileDown,
  X,
} from "lucide-react";
import type { MapViewData } from "@/components/MapView";
import type { Config, Location, OptimizerResult, RawFileData, ValidatedRow, ColumnMapping } from "@/types";
import { applyMapping } from "@/utils/parser";
import { cn } from "@/lib/utils";
import { useToast } from "@/lib/toast";
import { useOptimizationFlow, useRouteEditor, useHomePlacement } from "@/hooks";
import { downloadRoutePlan } from "@/lib/routeExport";

import FileUpload from "@/components/FileUpload";
import ColumnMapper from "@/components/ColumnMapper";
import DataEditor from "@/components/DataEditor";
import ConfigPanel from "@/components/ConfigPanel";
import ResultsPanel from "@/components/ResultsPanel";
import OptimizeButton from "@/components/OptimizeButton";
import OptimizeProgress from "@/components/OptimizeProgress";
import UnreachableWarning from "@/components/UnreachableWarning";
import WizardSteps from "@/components/WizardSteps";
import Sidebar from "@/components/Sidebar";
import RouteEditor from "@/components/RouteEditor";
import MapPOIActionBar from "@/components/MapPOIActionBar";
import FloatingUnassignedPanel from "@/components/FloatingUnassignedPanel";
import LocaleSwitcher from "@/i18n/LocaleSwitcher";

// MapView imports Leaflet at module level — dynamic import defers it
// to client-side only (window is not defined during SSR).
const MapView = dynamic(() => import("@/components/MapView").then((m) => m.default), { ssr: false });

type PhaseKey = "upload" | "mapping" | "review" | "config" | "results";

export default function Home() {
  // ── i18n ──
  const { t, i18n } = useTranslation();

  // ── Toasts ──
  const { show: showToast } = useToast();
  const notify = useCallback(
    (msg: string, kind: "error" | "info") => showToast(msg, { kind }),
    [showToast],
  );
  const reportExportError = useCallback(
    (msg: string) => showToast(msg, { kind: "error" }),
    [showToast],
  );

  // ── Wizard state (stays in page.tsx) ──
  const [phase, setPhase] = useState<PhaseKey>("upload");
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
  const [algorithm, setAlgorithm] = useState<"auto" | "nsga2">("nsga2");
  const [exportOpen, setExportOpen] = useState(false);

  // ── Hooks ──
  const home = useHomePlacement({ config, setConfig });
  const flow = useOptimizationFlow({
    locations,
    config,
    algorithm,
    t,
    notify,
    onSuccess: () => {
      setPhase("results");
      setSidebarOpen(true);
    },
  });
  const editor = useRouteEditor({
    result: flow.result,
    optimizerResults: flow.optimizerResults,
    config,
    locations,
    t,
    onApply: flow.handleApply,
  });

  // ── Wizard transition handlers ──
  const handleFileLoaded = useCallback((data: RawFileData) => {
    setRawData(data);
    setSidebarOpen(true);
    setPhase("mapping");
  }, []);

  const handleMappingConfirm = useCallback(
    (mapping: ColumnMapping, dataRows: Record<string, unknown>[]) => {
      try {
        const rows = applyMapping(dataRows, mapping);
        setValidatedRows(rows);
        setSidebarOpen(true);
        setPhase("review");
      } catch (err) {
        const msg = err instanceof Error ? err.message : t("wizard.errors.applyMapping");
        notify(msg, "error");
      }
    },
    [t, notify],
  );

  const handleRowsChange = useCallback((rows: ValidatedRow[]) => {
    setValidatedRows(rows);
  }, []);

  const handleReviewConfirm = useCallback((locs: Location[]) => {
    setLocations(locs);
    setSidebarOpen(true);
    setPhase("config");
  }, []);

  const handleReset = useCallback(() => {
    setRawData(null);
    setValidatedRows([]);
    setLocations([]);
    setPhase("upload");
    setSidebarOpen(true);
    flow.handleReset();
    editor.reset();
  }, [flow, editor]);

  // ── Wizard steps ──
  const PHASES = useMemo(
    () =>
      [
        { key: "upload", label: t("wizard.steps.upload"), Icon: FolderOpen },
        { key: "mapping", label: t("wizard.steps.mapping"), Icon: ClipboardList },
        { key: "review", label: t("wizard.steps.review"), Icon: Pencil },
        { key: "config", label: t("wizard.steps.config"), Icon: Settings },
        { key: "results", label: t("wizard.steps.results"), Icon: CheckCheck },
      ] as const,
    [t],
  );
  const currentIdx = PHASES.findIndex((p) => p.key === phase);

  // ── Map data (derived) ──
  const mapData = useMemo((): MapViewData => {
    const homeCoord =
      config.homeLat && config.homeLng
        ? { lat: config.homeLat, lng: config.homeLng }
        : undefined;

    if (phase === "review") {
      return { markers: validatedRows };
    }

    if (phase === "results" && flow.result) {
      const preview = editor.previewDays ?? (editor.editMode && editor.editDaysPreview ? editor.editDaysPreview : null);
      const editRoutes = preview ?? flow.result.days;
      return {
        routes: editRoutes,
        locations,
        home: homeCoord,
        hiddenDays: flow.hiddenDays,
        routingMode: editor.previewDays ? "haversine" : flow.routingMode,
        routeGeometry:
          !editor.previewDays && flow.routingMode === "osrm" ? flow.routeGeometry ?? undefined : undefined,
        routeSource:
          !editor.previewDays && flow.routingMode === "osrm" ? flow.routeSource ?? undefined : undefined,
      };
    }

    if (phase === "config") {
      return { locations, home: homeCoord };
    }

    return {};
  }, [phase, validatedRows, locations, config, flow.result, flow.hiddenDays, flow.routingMode, flow.routeGeometry, flow.routeSource, editor.previewDays, editor.editMode, editor.editDaysPreview]);

  // ── Sidebar content per phase ──
  const sidebarTitle = PHASES[currentIdx]?.label ?? "";
  const sidebarSubtitle =
    phase === "review"
      ? `${validatedRows.filter((r) => r.selected && r.isValid).length} de ${validatedRows.length} selecionadas`
      : phase === "config"
        ? `${locations.length} ubicaciones`
        : phase === "results" && flow.result
          ? `${flow.result.totalDays} días · ${flow.result.totalDistance.toFixed(0)} km`
          : undefined;

  const exportButton = flow.result ? (
    <div className="relative">
      <button
        onClick={() => setExportOpen((v) => !v)}
        className="btn-secondary w-full text-sm inline-flex items-center justify-center gap-1.5"
      >
        <FileDown className="w-4 h-4" />
        {t("export.exportPlan")}
      </button>
      {exportOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
          <div className="absolute bottom-full left-0 right-0 mb-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden divide-y divide-gray-100">
            {(["html", "pdf", "docx", "xlsx"] as const).map((fmt) => {
              const color = { html: "blue", pdf: "red", docx: "blue", xlsx: "green" }[fmt];
              const desc = t(`export.${fmt}Desc`);
              return (
                <button
                  key={fmt}
                  onClick={() => {
                    downloadRoutePlan(
                      {
                        days: flow.result!.days,
                        totalDistance: flow.result!.totalDistance,
                        totalDays: flow.result!.totalDays,
                        totalLocations: flow.result!.totalLocations,
                        locale: i18n.language,
                      },
                      fmt,
                      reportExportError,
                    );
                    setExportOpen(false);
                  }}
                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2"
                >
                  <span
                    className={cn(
                      "text-xs font-mono w-12 font-semibold",
                      color === "red" && "text-red-600",
                      color === "blue" && (fmt === "docx" ? "text-blue-800" : "text-blue-600"),
                      color === "green" && "text-green-700",
                    )}
                  >
                    {fmt.toUpperCase()}
                  </span>
                  <span className="text-gray-700">{desc}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  ) : null;

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
            <WizardSteps
              phases={PHASES as unknown as { key: PhaseKey; label: string; Icon: typeof FolderOpen }[]}
              currentIdx={currentIdx}
              onStepClick={(i) => setPhase(PHASES[i]!.key)}
            />
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
            <WizardSteps
              phases={PHASES as unknown as { key: PhaseKey; label: string; Icon: typeof FolderOpen }[]}
              currentIdx={currentIdx}
              onStepClick={(i) => setPhase(PHASES[i]!.key)}
            />
            <div className="mt-3 space-y-4">
              {flow.optimizePhase === "idle" || flow.optimizePhase === "done" ? (
                <>
                  <ConfigPanel
                    config={config}
                    onChange={setConfig}
                    locationCount={locations.length}
                    placingHome={home.placingHome}
                    onTogglePlaceHome={home.handleTogglePlaceHome}
                  />
                  <div className="text-center text-xs text-gray-400 bg-gray-50 rounded-lg p-2 border border-gray-200">
                    {t("wizardPage.bothAlgorithms")}
                  </div>
                  <OptimizeButton
                    onClick={flow.handleOptimize}
                    loading={flow.loading}
                    disabled={locations.length === 0}
                  />
                  <button
                    onClick={() => setPhase("review")}
                    className="btn-secondary w-full text-sm"
                  >
                    {t("wizardPage.backToEditLocations")}
                  </button>
                </>
              ) : (
                <OptimizeProgress
                  progress={flow.matrixProgress}
                  phase={flow.optimizePhase === "algorithm" ? "algorithm" : "matrix"}
                  totalLocations={locations.length}
                  error={flow.error ?? undefined}
                />
              )}
            </div>
          </>
        );
      case "results":
        return flow.result ? (
          <>
            <WizardSteps
              phases={PHASES as unknown as { key: PhaseKey; label: string; Icon: typeof FolderOpen }[]}
              currentIdx={currentIdx}
              onStepClick={(i) => setPhase(PHASES[i]!.key)}
            />
            <div className="mt-3 space-y-3">
              {!editor.editMode && (
                <ResultsPanel
                  days={flow.result.days}
                  totalDistance={flow.result.totalDistance}
                  totalDays={flow.result.totalDays}
                  totalLocations={flow.result.totalLocations}
                  hiddenDays={flow.hiddenDays}
                  onToggleDay={flow.handleToggleDay}
                  onExpandDay={(day) => flow.handleExpandDay(day)}
                  expandedDay={editor.sidebarExpandedDay}
                  onExpandedDayChange={editor.setSidebarExpandedDay}
                  results={flow.optimizerResults ?? undefined}
                  activeAlgorithm={flow.activeAlgorithm}
                  winnerAlgorithm={flow.winnerAlgorithm}
                  onAlgorithmChange={flow.handleAlgorithmChange}
                  useConsensus={flow.useConsensus}
                  meta={flow.result._meta}
                  locale={i18n.language}
                />
              )}

              {flow.result.unreachable && flow.result.unreachable.length > 0 && (
                <UnreachableWarning
                  unreachable={flow.result.unreachable}
                  onRetry={flow.handleOptimize}
                  loading={flow.loading}
                />
              )}

              {flow.result.days.length > 0 && (
                <button
                  onClick={editor.toggleEditMode}
                  className={cn(
                    "w-full text-sm py-2 rounded-lg font-medium transition-all",
                    editor.editMode
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                  )}
                >
                  {editor.editMode
                    ? editor.editorDirty
                      ? t("routeEditor.finishEditingWithChanges")
                      : t("routeEditor.finishEditing")
                    : t("routeEditor.editRoutes")}
                </button>
              )}

              {editor.editMode && flow.result && (
                <RouteEditor
                  ref={editor.editorRef}
                  result={flow.result}
                  config={config}
                  locations={locations}
                  matrix={flow.distanceMatrix ?? undefined}
                  selectedPOI={editor.selectedPOI}
                  onPOISelect={editor.handlePOISelect}
                  onApply={editor.handleApply}
                  onDirtyChange={editor.setEditorDirty}
                  onDiscard={editor.handleDiscard}
                  onWorkingDaysChange={editor.setEditDaysPreview}
                  onClearSelection={editor.clearSelection}
                  hiddenDays={flow.hiddenDays}
                  onToggleDay={flow.handleToggleDay}
                />
              )}

              <button
                onClick={() => flow.setHiddenDays(new Set())}
                className="w-full text-xs text-center text-gray-400 hover:text-blue-600 transition-colors py-1 inline-flex items-center justify-center gap-1.5"
              >
                <Eye className="w-3.5 h-3.5" />
                Ver todas las rutas en el mapa
              </button>

              {exportButton}

              <div className="flex flex-col gap-2">
                <button onClick={() => setPhase("config")} className="btn-secondary w-full text-sm">
                  {t("wizardPage.backToConfig")}
                </button>
                <button
                  onClick={handleReset}
                  className="btn-secondary w-full text-sm inline-flex items-center justify-center gap-1.5"
                >
                  <PlusCircle className="w-4 h-4" />
                  {t("wizardPage.newOptimization")}
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
      {/* Locale switcher — top-right, always visible. */}
      <div className="fixed top-4 right-4 z-40 bg-white border border-gray-200 rounded-lg shadow-sm px-2 py-1">
        <LocaleSwitcher />
      </div>

      {/* Full-screen map. */}
      <MapView
        data={mapData}
        placementMode={home.placementMode}
        onPlaceHome={home.handlePlaceHome}
        onDragHome={home.handleDragHome}
        selectedPOI={editor.selectedPOI}
        onPOIClick={(lat, lng, day, name) => {
          editor.setSelectedPOI({ name, lat, lng, day });
          editor.setHighlightDay(day);
          editor.setSidebarExpandedDay(day);
        }}
        highlightDay={editor.highlightDay}
        homeDraggable={phase === "config"}
      />

      {/* Floating POI action bar (edit mode only). */}
      {editor.editMode && editor.selectedPOI && (
        <MapPOIActionBar
          poiName={editor.selectedPOI.name}
          currentDay={editor.selectedPOI.day}
          availableDays={editor.availableDays}
          previewTargetDay={editor.previewTargetDay}
          onSelectDay={editor.handlePreviewDay}
          onAccept={editor.handleAcceptMove}
          onCancel={editor.handleCancelMove}
        />
      )}

      {/* Floating unassigned POIs panel. */}
      <FloatingUnassignedPanel
        pois={editor.unassignedPOIs}
        onPOIClick={(lat, lng, name) => editor.handleUnassignedClick(lat, lng, name)}
      />

      {/* Legacy in-page error banner — toasts handle the primary
          surface, but the wizard still reads `flow.error` for the
          OptimizeProgress error slot. Hidden when no error. */}
      {flow.error && (
        <div
          role="alert"
          aria-live="polite"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-50 border border-red-200 rounded-lg shadow-lg text-sm text-red-700 max-w-md flex items-center gap-2 animate-slide-down"
        >
          <span className="font-medium">Error:</span>
          <span className="flex-1">{flow.error}</span>
          <button
            onClick={() => flow.setError(null)}
            aria-label={t("ariaLabels.closeError")}
            className="text-red-400 hover:text-red-600 inline-flex items-center"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Sidebar */}
      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((o) => !o)}
        title={sidebarTitle}
        sidebarIcon={<Truck className="w-4 h-4 text-blue-600" />}
        subtitle={sidebarSubtitle}
      >
        {phase !== "upload" && (
          <button
            onClick={handleReset}
            className="text-xs text-gray-400 hover:text-blue-600 transition-colors mb-3 block"
          >
            {t("wizardPage.sidebarNewOptimization")}
          </button>
        )}
        {sidebarContent}
      </Sidebar>
    </div>
  );
}
