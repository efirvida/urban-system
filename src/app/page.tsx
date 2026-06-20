"use client";

import { useCallback, useState, useMemo, useRef, useEffect } from "react";
import {
  FolderOpen,
  ClipboardList,
  Pencil,
  Settings,
  CheckCheck,
  Truck,
  Car,
  Eye,
  PlusCircle,
  X,
  FileDown,
} from "lucide-react";
import {
  Location,
  Config,
  DayRoute,
  OptimizerResult,
  OptimizeResponse,
  RawFileData,
  ValidatedRow,
  ColumnMapping,
  isDayRouteArray,
  isOptimizeMeta,
} from "@/types";
import { applyMapping } from "@/utils/parser";
import { cn } from "@/lib/utils";
import { buildDistanceMatrices, fetchAllRouteGeometries, MatrixProgress, RouteSource } from "@/utils/clientRouting";
import { reoptimizeDay } from "@/utils/routerOptimizer";
import { useTranslation } from "react-i18next";
import LocaleSwitcher from "@/i18n/LocaleSwitcher";

// ─── Matrix cache (localStorage) ─────────────────────────────
// Format: { d: Record<"i,j", km>, home?: { lat, lng } }
// Per-leg caches live in the routing cache (`routing/cache.ts`), so
// this matrix cache only records the aggregated distances to skip
// rebuilding the whole matrix when the location set is unchanged.

interface CachedMatrix {
  d: Record<string, number>;
  home?: { lat: number; lng: number }; // home coord when cached
}

const MC_PREFIX = "vrp_matrix_";

function locationsHash(locs: Location[]): string {
  const coords = locs.map(l => `${l.lat.toFixed(6)},${l.lng.toFixed(6)}`).sort();
  let h = 5381;
  for (const s of coords.join("|")) h = ((h << 5) + h + s.charCodeAt(0)) | 0;
  return Math.abs(h).toString(36);
}

/**
 * Load a previously-cached matrix for this exact set of locations.
 *
 * If the cached home coordinate is within ~300m of the current home,
 * all pairs (including home↔POI) are returned. Otherwise only the
 * POI↔POI pairs come back and the caller rebuilds the home pairs via
 * `buildDistanceMatrices`, which uses the routing cache's per-leg
 * store to avoid re-fetching the same POI↔POI pairs.
 */
function loadCachedMatrix(
  locs: Location[],
  currentHomeLat?: number,
  currentHomeLng?: number,
): { distances: Record<string, number>; cachedHome?: { lat: number; lng: number } } | null {
  try {
    const key = MC_PREFIX + locationsHash(locs);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedMatrix;

    // Check if cached home matches current home (within 300m)
    let homeMatches = false;
    if (parsed.home && currentHomeLat !== undefined && currentHomeLng !== undefined) {
      const d = Math.abs(currentHomeLat - parsed.home.lat) + Math.abs(currentHomeLng - parsed.home.lng);
      homeMatches = d <= 0.005; // ~equivalent to 300m at mid-latitudes
    }

    const distances: Record<string, number> = {};

    if (homeMatches && parsed.d) {
      // Home matches → load ALL pairs including home
      for (const k of Object.keys(parsed.d)) {
        distances[k] = parsed.d[k];
      }
    } else {
      // Home changed or missing → load only POI pairs
      for (const k of Object.keys(parsed.d)) {
        if (k.startsWith("0,")) continue;
        distances[k] = parsed.d[k];
      }
    }

    const expectedPairs = homeMatches
      ? (locs.length * (locs.length + 1)) / 2  // all pairs including home
      : (locs.length * (locs.length - 1)) / 2;  // POI only
    if (Object.keys(distances).length !== expectedPairs) {
      console.log(`[Cache] Mismatch (expected ${expectedPairs}, got ${Object.keys(distances).length}), discarding`);
      localStorage.removeItem(key);
      return null;
    }
    console.log(`[Cache] HIT: ${key} (${Object.keys(distances).length} pairs, homeMatch=${homeMatches})`);
    return { distances, cachedHome: parsed.home };
  } catch { return null; }
}

function saveCachedMatrix(
  locs: Location[],
  distances: Record<string, number>,
  homeLat?: number,
  homeLng?: number
): void {
  try {
    const key = MC_PREFIX + locationsHash(locs);
    const toStore: CachedMatrix = { d: { ...distances } };
    if (homeLat !== undefined && homeLng !== undefined) toStore.home = { lat: homeLat, lng: homeLng };
    localStorage.setItem(key, JSON.stringify(toStore));
    console.log(`[Cache] SAVED: ${key} (${Object.keys(toStore.d).length} total pairs)`);
  } catch (err) {
    console.warn("[Cache] Failed to save:", err);
  }
}

import FileUpload from "@/components/FileUpload";
import ColumnMapper from "@/components/ColumnMapper";
import DataEditor from "@/components/DataEditor";
import ConfigPanel from "@/components/ConfigPanel";
import ResultsPanel from "@/components/ResultsPanel";
import OptimizeButton from "@/components/OptimizeButton";
import OptimizeProgress from "@/components/OptimizeProgress";
import UnreachableWarning from "@/components/UnreachableWarning";
import WizardSteps from "@/components/WizardSteps";
import dynamic from "next/dynamic";
import type { MapViewData } from "@/components/MapView";
// MapView imports Leaflet at module level, which crashes during Next.js
// prerendering ("window is not defined"). `ssr: false` defers the import
// to client-side execution. The map is inherently a client-only component
// (needs the browser to render tiles), so this matches the pre-Leaflet
// behavior where the map only appeared after hydration.
const MapView = dynamic(() => import("@/components/MapView").then(m => m.default), { ssr: false });
import Sidebar from "@/components/Sidebar";
import RouteEditor, { RouteEditorHandle } from "@/components/RouteEditor";
import MapPOIActionBar from "@/components/MapPOIActionBar";
import FloatingUnassignedPanel from "@/components/FloatingUnassignedPanel";
import { downloadRoutePlan } from "@/lib/routeExport";

// ─── Phase definition ───────────────────────────────────────
// Phase keys are stable (used in URL/state); labels are translated
// at render time so the wizard step text follows the active locale.

type PhaseKey = "upload" | "mapping" | "review" | "config" | "results";

// ─── Component ──────────────────────────────────────────────

export default function Home() {
  // ── i18n ──
  const { t, i18n } = useTranslation();

  const PHASES = [
    { key: "upload", label: t("wizard.steps.upload"), Icon: FolderOpen },
    { key: "mapping", label: t("wizard.steps.mapping"), Icon: ClipboardList },
    { key: "review", label: t("wizard.steps.review"), Icon: Pencil },
    { key: "config", label: t("wizard.steps.config"), Icon: Settings },
    { key: "results", label: t("wizard.steps.results"), Icon: CheckCheck },
  ] as const;

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
  const [distanceMatrix, setDistanceMatrix] = useState<Record<string, number> | null>(null);
  const [routingMode, setRoutingMode] = useState<RouteSource | "haversine">("osrm");
  const [routeGeometry, setRouteGeometry] = useState<Map<number, [number, number][]> | null>(null);
  /** Per-day routing source — drives dashed styling on the map. */
  const [routeSource, setRouteSource] = useState<Map<number, RouteSource> | null>(null);
  const [algorithm, setAlgorithm] = useState<"auto" | "nsga2">("nsga2");
  const [useConsensus, setUseConsensus] = useState(false);

  // Route editing
  const [editMode, setEditMode] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  /** Live preview of editable days — used by the map during editing. */
  const [editDaysPreview, setEditDaysPreview] = useState<DayRoute[] | null>(null);
  /** Currently-selected POI on the map. Drives sidebar highlight. */
  const [selectedPOI, setSelectedPOI] = useState<{
    lat: number;
    lng: number;
    day: number;
    name: string;
  } | null>(null);
  const [highlightDay, setHighlightDay] = useState<number | null>(null);
  /** Which day is expanded in the ResultsPanel sidebar. */
  const [sidebarExpandedDay, setSidebarExpandedDay] = useState<number | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  /** Floating action bar: target day being previewed (null = no preview). */
  const [previewTargetDay, setPreviewTargetDay] = useState<number | null>(null);
  /** Preview routes — shown on the map while user decides in the action bar. */
  const [previewDays, setPreviewDays] = useState<DayRoute[] | null>(null);
  /**
   * Per-algorithm results from `/api/optimize`, in registration order
   * (CW, NSGA-II, Geoapify). A slot is `null` when the optimizer was
   * unavailable (e.g. missing `GEOAPIFY_API_KEY`) or failed. Drives the
   * algorithm tab bar in `ResultsPanel`.
   */
  const [optimizerResults, setOptimizerResults] = useState<(OptimizerResult | null)[] | null>(null);
  /** Algorithm id of the currently displayed result. */
  const [activeAlgorithm, setActiveAlgorithm] = useState<string | null>(null);

  const editorRef = useRef<RouteEditorHandle | null>(null);

  /** Available day numbers — from editDaysPreview or result. */
  const availableDays = useMemo(() => {
    const source = editDaysPreview ?? result?.days ?? [];
    return [...new Set(source.map((d) => d.day))].sort((a, b) => a - b);
  }, [editDaysPreview, result]);

  /** Unassigned POIs — locations not in any route stop, both view and edit mode. */
  const unassignedPOIs = useMemo(() => {
    if (!locations) return [];
    const sourceRoutes = editMode ? (editDaysPreview ?? []) : (result?.days ?? []);
    const assigned = new Set<string>();
    for (const day of sourceRoutes) {
      for (const s of day.stops) {
        if (s.isHome) continue;
        assigned.add(`${s.lat.toFixed(5)},${s.lng.toFixed(5)}`);
      }
    }
    return locations.filter((l) => !assigned.has(`${l.lat.toFixed(5)},${l.lng.toFixed(5)}`));
  }, [editMode, editDaysPreview, result, locations]);

  /** Calculate preview routes when the user selects a target day or "Sin ruta". */
  const handlePreviewDay = useCallback(
    (targetDay: number | null) => {
      if (!selectedPOI || !editDaysPreview) return;
      setPreviewTargetDay(targetDay);

      // null means cancel preview (same as current)
      if (targetDay === null || targetDay === selectedPOI.day) {
        setPreviewDays(null);
        return;
      }

      // Mostrar SOLO el día destino durante el preview
      setHighlightDay(targetDay);
      setHiddenDays((prev) => {
        const allDays = editDaysPreview?.map((d) => d.day) ?? [];
        return new Set(allDays.filter((d) => d !== targetDay));
      });

      const home: Location = { name: t("routeEditor.home"), lat: config.homeLat, lng: config.homeLng };
      const stopsToLocs = (stops: Array<{ name: string; lat: number; lng: number; isHome?: boolean }>) =>
        stops.filter((s) => !s.isHome).map((s) => ({ name: s.name, lat: s.lat, lng: s.lng }));

      // targetDay === 0 means "Sin ruta" (remove from route)
      if (targetDay === 0) {
        const sourceDay = editDaysPreview.find((d) => d.day === selectedPOI.day);
        if (!sourceDay) return;
        const sourcePois = stopsToLocs(sourceDay.stops).filter((s) => s.name !== selectedPOI.name);
        const newSource = reoptimizeDay(sourcePois, home, config, undefined, sourceDay.day, undefined);
        const preview = editDaysPreview.map((d) => d.day === sourceDay.day ? newSource : d);
        setPreviewDays(preview);
        return;
      }

      // POI no asignado (day === -1) — agregar al día destino sin origen
      if (selectedPOI.day === -1) {
        const targetDayData = editDaysPreview.find((d) => d.day === targetDay);
        if (!targetDayData) return;
        const targetPois = stopsToLocs(targetDayData.stops).concat([
          { name: selectedPOI.name, lat: selectedPOI.lat, lng: selectedPOI.lng },
        ]);
        const newTarget = reoptimizeDay(targetPois, home, config, undefined, targetDayData.day, undefined);
        const preview = editDaysPreview.map((d) => d.day === targetDayData.day ? newTarget : d);
        setPreviewDays(preview);
        return;
      }

      // POI asignado — mover de un día a otro
      const sourceDay = editDaysPreview.find((d) => d.day === selectedPOI.day);
      const targetDayData = editDaysPreview.find((d) => d.day === targetDay);
      if (!sourceDay || !targetDayData) return;

      const sourcePois = stopsToLocs(sourceDay.stops).filter((s) => s.name !== selectedPOI.name);
      const targetPois = stopsToLocs(targetDayData.stops).concat([
        { name: selectedPOI.name, lat: selectedPOI.lat, lng: selectedPOI.lng },
      ]);

      const newSource = reoptimizeDay(sourcePois, home, config, undefined, sourceDay.day, undefined);
      const newTarget = reoptimizeDay(targetPois, home, config, undefined, targetDayData.day, undefined);

      const preview = editDaysPreview.map((d) => {
        if (d.day === sourceDay.day) return newSource;
        if (d.day === targetDayData.day) return newTarget;
        return d;
      });
      setPreviewDays(preview);
    },
    [selectedPOI, editDaysPreview, config, t]
  );

  const handleAcceptMove = useCallback(() => {
    if (!selectedPOI || previewTargetDay === null || previewTargetDay === selectedPOI.day) return;
    const target = previewTargetDay === 0 ? null : previewTargetDay;

    if (selectedPOI.day === -1 && target !== null) {
      // POI was unassigned — add it to the target day
      editorRef.current?.addPOI?.(
        { name: selectedPOI.name, lat: selectedPOI.lat, lng: selectedPOI.lng },
        target
      );
    } else {
      // POI was assigned — move it
      editorRef.current?.commitMove(
        { name: selectedPOI.name, lat: selectedPOI.lat, lng: selectedPOI.lng, fromDay: selectedPOI.day },
        target
      );
    }

    setPreviewDays(null);
    setPreviewTargetDay(null);

    if (target === null) {
      setSelectedPOI(null);
      setHighlightDay(null);
    } else {
      setSelectedPOI({ ...selectedPOI, day: target });
      setHighlightDay(target);
      // Aislar el día destino en el mapa — ocultar los demás días
      setHiddenDays((prev) => {
        const allDays = editDaysPreview?.map((d) => d.day) ?? [];
        return new Set(allDays.filter((d) => d !== target));
      });
    }
  }, [selectedPOI, previewTargetDay, editDaysPreview]);

  const handleCancelMove = useCallback(() => {
    setPreviewDays(null);
    setPreviewTargetDay(null);
    // Restaurar highlight al día del POI seleccionado
    if (selectedPOI) {
      setHighlightDay(selectedPOI.day);
      setHiddenDays((prev) => {
        const allDays = editDaysPreview?.map((d) => d.day) ?? result?.days.map((d) => d.day) ?? [];
        return new Set(allDays.filter((d) => d !== selectedPOI.day));
      });
    }
  }, [selectedPOI, editDaysPreview, result]);

  /** Toggle a day's visibility on the map. */
  const handleToggleDay = useCallback((day: number) => {
    setHiddenDays((prev) => {
      const wasHidden = prev.has(day);
      // No cambiamos highlightDay al toggle — el resalte/atenuado de rutas
      // solo debe ocurrir cuando se interactúa directamente en el mapa.
      // Desde el sidebar, cada día es independiente.
      setSelectedPOI(null);
      const next = new Set(prev);
      if (wasHidden) next.delete(day);
      else next.add(day);
      return next;
    });
  }, []);

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
      // Previews override editing previews — in order: previewDays > editDaysPreview > result.days
      const preview = previewDays ?? (editMode && editDaysPreview ? editDaysPreview : null);
      const editRoutes = preview ?? result.days;
      return {
        routes: editRoutes,
        // In results mode, include all locations — useLeafletMarkers skips
        // assigned ones (they already have route stop markers) and shows
        // unassigned as red pins.
        locations,
        home,
        hiddenDays,
        // During editing, use straight lines (Haversine) for instant visual feedback.
        // After accepting edits, OSRM geometry is refetched via refetchGeometries.
        // Durante preview (proposed moves) usar línea recta. En edición usar la
        // última ruta real disponible — refetchGeometries la actualiza tras cada edición.
        routingMode: previewDays ? "haversine" : routingMode,
        routeGeometry: !previewDays && routingMode === "osrm" ? routeGeometry ?? undefined : undefined,
        routeSource: !previewDays && routingMode === "osrm" ? routeSource ?? undefined : undefined,
      };
    }

    if (phase === "config") {
      return { locations, home };
    }

    return {};
  }, [phase, validatedRows, locations, config, result, hiddenDays, routingMode, routeGeometry, routeSource, editMode, editDaysPreview, previewDays]);

  /** Fetch OSRM geometry for visible days (lazy, cached) */
  const fetchGeometryForVisible = useCallback(
    (_days: DayRoute[], _hidden: Set<number>) => {
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
          err instanceof Error ? err.message : t("wizard.errors.applyMapping")
        );
      }
    },
    [t]
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
    const FLOW = "[FLOW]";
    const t0 = Date.now();
    console.log(`${FLOW} ══════ OPTIMIZE START ══════`);
    console.log(`${FLOW} Locations: ${locations.length}, Algorithm: ${algorithm}`);
    console.log(`${FLOW} Config:`, JSON.stringify({ homeLat: config.homeLat, homeLng: config.homeLng, constraintType: config.constraintType, constraintValue: config.constraintValue, avgSpeed: config.avgSpeed, visitTime: config.visitTime }));

    if (locations.length === 0) {
      setError(t("wizard.errors.noValidLocations"));
      return;
    }
    if (!config.homeLat || !config.homeLng) {
      setError(t("wizard.errors.configureHome"));
      return;
    }

    setLoading(true);
    setError(null);
    setMatrixProgress(null);
    setOptimizePhase("matrix");
    // Yield para que React pinte "Preparando optimización..."
    await new Promise(r => setTimeout(r, 100));

    try {
      // ── Paso 1: Matriz de distancias ──
      // When consensus is active the server builds the full matrix from
      // Geoapify Matrix API + ORS Matrix API + OSRM, so we skip the
      // client-side build entirely. Otherwise we use the legacy pipeline.
      // Toggle with NEXT_PUBLIC_USE_CONSENSUS=false in `.env.local` to fall
      // back to the legacy client-side matrix path.
      const USE_CONSENSUS_MATRIX = process.env.NEXT_PUBLIC_USE_CONSENSUS !== "false";
      let distances: Record<string, number> = {};

      if (!USE_CONSENSUS_MATRIX) {
        const N = locations.length + 1;
        const totalPairs = (N * (N - 1)) / 2;
        const fullPairCount = (locations.length * (locations.length + 1)) / 2;

        const cached = loadCachedMatrix(locations, config.homeLat, config.homeLng);
        const cachedHasFullMatrix = cached && Object.keys(cached.distances).length >= fullPairCount;

        if (cachedHasFullMatrix) {
          distances = cached.distances;
          console.log(`${FLOW} Cache HIT (full): ${Object.keys(distances).length}/${fullPairCount} pairs`);
        } else {
          const reason = cached ? "partial" : "miss";
          console.log(`${FLOW} Cache ${reason} — building matrix via RoutingService (${totalPairs} pairs)`);
          setOptimizePhase("matrix");
          await new Promise(r => setTimeout(r, 50));
          const tBuild = Date.now();
          const { osrmMatrix } = await buildDistanceMatrices(
            config.homeLat,
            config.homeLng,
            locations,
            (p) => setMatrixProgress(p),
          );
          for (const [key, value] of osrmMatrix) {
            distances[key] = value;
          }
          const realCount = Object.values(distances).filter((v) => Number.isFinite(v)).length;
          const unreachableCount = totalPairs - realCount;
          console.log(`${FLOW} Matrix built: ${realCount} real, ${unreachableCount} unreachable in ${Date.now() - tBuild}ms`);
          saveCachedMatrix(locations, distances, config.homeLat, config.homeLng);
        }
      } else {
        console.log(`${FLOW} Consensus mode — building matrix on server (Geoapify + ORS + OSRM)`);
        // Keep phase="matrix" during the API call — the server is building
        // the consensus matrix. OptimizeProgress shows a spinner with
        // "Calculando matriz para N ubicaciones con Geoapify + ORS + OSRM (consenso)..."
        setOptimizePhase("matrix");
        await new Promise(r => setTimeout(r, 50));
      }

      // ── Paso 2: Enviar al server ──
      // In consensus mode, phase is still "matrix" (the API builds it).
      // In legacy mode, phase was already set above during buildDistanceMatrices.
      if (!USE_CONSENSUS_MATRIX) {
        setOptimizePhase("algorithm");
        await new Promise(r => setTimeout(r, 100));
      }
      console.log(`${FLOW} ── Phase: ${USE_CONSENSUS_MATRIX ? "CONSENSUS MATRIX (server)" : "ALGORITHM"} (${algorithm}) ──`);

      const tAlgo = Date.now();
      const apiPayload: Record<string, unknown> = {
        locations, config, algorithm,
        distanceMatrix: distances,
        // PR 6 (real-roads-only): feature flag — when true, the API
        // builds a `DistanceMatrix` with per-pair source metadata and
        // passes it through to the optimizer. Default `false` keeps the
        // legacy `Record<string, number>` path bit-identical to pre-PR-6.
        useStrictMatrix: config?.useStrictMatrix ?? false,
        // Consensus-matrix: when true, the server builds a cross-validated
        // matrix from Geoapify Matrix API + ORS Matrix API + OSRM, surfaces
        // per-pair reliability, and the optimizers reject low-confidence legs.
        useConsensus: USE_CONSENSUS_MATRIX,
      };

      console.log(`${FLOW} POST /api/optimize — ${locations.length} locs, ${Object.keys(distances).length} pairs`);
      const apiRes = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiPayload),
      });

      let apiData: Record<string, unknown> = {};

      if (USE_CONSENSUS_MATRIX) {
        // NDJSON stream — read progress events in real time, then the final result.
        const contentType = apiRes.headers.get("content-type") || "";
        if (contentType.includes("x-ndjson")) {
          const reader = apiRes.body?.getReader();
          if (!reader) throw new Error("No response body");

          const decoder = new TextDecoder();
          let buffer = "";

          const processLine = (line: string) => {
            if (!line.trim()) return;
            try {
              const event = JSON.parse(line);
              if (event.type === "progress") {
                setMatrixProgress({
                  phase: "matrix",
                  stage: event.detail || event.stage,
                  current: event.current,
                  total: event.total,
                  percent: Math.round((event.current / event.total) * 100),
                  etaSeconds: 0,
                  geoapifyCount: event.geoapifyCount ?? 0,
                  osrmCount: event.osrmCount ?? 0,
                  unreachableCount: 0,
                });
              } else if (event.type === "result") {
                apiData = event.data;
              } else if (event.type === "error") {
                throw new Error(event.error || "Server error during consensus");
              }
            } catch (e) {
              if (e instanceof SyntaxError) return; // skip malformed lines
              throw e;
            }
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || ""; // keep partial line
            for (const line of lines) processLine(line);
          }
          // Process remaining buffer
          if (buffer.trim()) processLine(buffer);

          if (!apiData) throw new Error("No result event in stream");
        } else {
          // Fallback: non-streaming response
          if (!apiRes.ok) {
            const errData = await apiRes.json().catch(() => ({ error: `HTTP ${apiRes.status}` }));
            throw new Error(errData.error || `Error del servidor (${apiRes.status})`);
          }
          apiData = await apiRes.json();
        }

        // Consensus matrix built — transition to algorithm phase
        setOptimizePhase("algorithm");
        await new Promise(r => setTimeout(r, 50));
      } else {
        // Legacy mode: normal JSON response
        if (!apiRes.ok) {
          const errData = await apiRes.json().catch(() => ({ error: `HTTP ${apiRes.status}` }));
          throw new Error(errData.error || `Error del servidor (${apiRes.status})`);
        }
        apiData = await apiRes.json();
      }

      console.log(`${FLOW} API response in ${Date.now() - tAlgo}ms`);

      // ── Parse combined result (registry ran on server) ──
      let optResult: OptimizeResponse;
      let geometryDays: Array<{ day: number; stops: Array<{ lat: number; lng: number; isHome?: boolean }> }> | undefined;

      const bestDays: DayRoute[] = isDayRouteArray(apiData.days) ? apiData.days : [];
      const bestDist = Number(apiData.totalDistance);
      const bestCnt = Number(apiData.totalDays);

      // Pull per-algorithm results (registration order) + pick the
      // winner for the default tab. Best = lowest totalDistance, then
      // fewer days, then earlier registration. Mirrors the server.
      const allResults = (apiData.results ?? []) as (OptimizerResult | null)[];
      let winner: OptimizerResult | null = null;
      for (const r of allResults) {
        if (r === null) continue;
        if (
          winner === null ||
          r.totalDistance < winner.totalDistance - 1 ||
          (Math.abs(r.totalDistance - winner.totalDistance) <= 1 &&
            r.totalDays < winner.totalDays)
        ) {
          winner = r;
        }
      }
      if (!winner) {
        throw new Error(t("wizard.errors.noResult"));
      }
      const okCount = allResults.filter((r) => r !== null).length;
      console.log(
        `${FLOW} Registry: ${okCount}/${allResults.length} ok, winner=${winner.algorithm} (${winner.totalDays}d · ${winner.totalDistance}km)`,
      );
      for (const r of allResults) {
        if (r === null) continue;
        console.log(
          `${FLOW}   - ${r.algorithm}: ${r.totalDays}d · ${r.totalDistance}km · ${r.label}`,
        );
      }

      setOptimizerResults(allResults);
      setActiveAlgorithm(winner.algorithm);
      // `_meta` is the API's optional telemetry block — guard it instead
      // of casting so we can read `useConsensus` without `as unknown as`.
      const apiMeta = isOptimizeMeta(apiData._meta) ? apiData._meta : undefined;
      setUseConsensus(apiMeta?.useConsensus === true);

      optResult = {
        days: bestDays,
        totalDistance: bestDist,
        totalDays: bestCnt,
        totalLocations: locations.length,
        unreachable: Array.isArray(apiData.unreachable) ? apiData.unreachable : [],
        _meta: apiMeta,
      };
      geometryDays = bestDays;
      setHiddenDays(new Set()); // Show all days by default
      setDistanceMatrix(distances);
      setResult(optResult);
      console.log(`${FLOW} Best: ${bestCnt}d · ${bestDist}km`);

      // ── Source breakdown (post-refactor: per-leg provider lives in the
      //     routing cache, not the matrix). The matrix just carries
      //     distances; the optimizer's _meta tells us how many pairs the
      //     server considered unreachable. ──
      {
        const realCount = Object.values(distances).filter((v) => Number.isFinite(v)).length;
        const unreachableCount = Object.values(distances).length - realCount;
        console.log(`${FLOW} ── Phase: DONE ──`);
        console.log(`${FLOW} Total elapsed: ${Date.now() - t0}ms`);
        console.log(`${FLOW} Matrix: ${realCount} real · ${unreachableCount} unreachable · total=${Object.keys(distances).length}`);
      }

      // Fetch route geometries (async, background)
      console.log(`${FLOW} geometryDays:`, geometryDays?.length ?? 0, "days");
      if (geometryDays && geometryDays.length > 0) {
        console.log(`${FLOW} Fetching route geometries for ${geometryDays.length} days...`);
        fetchAllRouteGeometries(geometryDays).then(({ geometries: geo, sources }) => {
          console.log(`${FLOW} Route geometries: ${geo.size}/${geometryDays.length} days resolved`);
          if (geo.size > 0) {
            console.log(`${FLOW} Setting routeGeometry with ${geo.size} routes`);
            setRouteGeometry(geo);
            setRouteSource(sources);
          }
        }).catch((err: unknown) => {
          console.error(`${FLOW} Route geometry error:`, err);
        });
      } else {
        console.log(`${FLOW} SKIP geometry fetch — geometryDays empty or undefined`);
      }

      // Pick the best available routing source for the map badge.
      const bestSource: RouteSource | "haversine" = (() => {
        if (!routeSource || routeSource.size === 0) return "osrm";
        for (const s of routeSource.values()) {
          if (s !== "haversine") return s;
        }
        return "haversine";
      })();
      setRoutingMode(bestSource);
      setOptimizePhase("done");
      setPhase("results");
      setSidebarOpen(true);
    } catch (err) {
      console.error(`${FLOW} ERROR:`, err);
      setError(err instanceof Error ? err.message : t("wizard.errors.unexpectedError"));
      setOptimizePhase("error");
    } finally {
      setLoading(false);
    }
  }, [locations, config, algorithm, routeSource, t]);

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

  /** Recalculate route geometries for a set of days (post-Apply). */
  const refetchGeometries = useCallback((days: DayRoute[]) => {
    if (days.length === 0) return;
    fetchAllRouteGeometries(days).then(({ geometries: geo, sources }) => {
      if (geo.size > 0) {
        setRouteGeometry(geo);
        setRouteSource(sources);
      }
    }).catch(err => {
      console.error("[FLOW] Post-Apply geometry fetch error:", err);
    });
  }, []);

  // ── Auto-dismiss error toast (6s) with cleanup on unmount/error change ──
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  // ── Refetch OSRM geometry after edits (debounced 800ms) ──
  useEffect(() => {
    if (!editMode || !editDaysPreview || editDaysPreview.length === 0) return;
    const timer = setTimeout(() => {
      refetchGeometries(editDaysPreview);
    }, 800);
    return () => clearTimeout(timer);
  }, [editDaysPreview, editMode, refetchGeometries]);

  /** Apply handler — commits editor's working days to the result. */
  const handleApply = useCallback((newDays: DayRoute[]) => {
    if (!result) return;
    const newTotalDistance = newDays.reduce((s, d) => s + d.totalDistance, 0);
    setResult({
      ...result,
      days: newDays,
      totalDistance: Math.round(newTotalDistance * 100) / 100,
      totalDays: newDays.length,
    });
    // Show all days by default
    setHiddenDays(new Set());
    // Refetch real-road geometry for the new days (background)
    setRoutingMode("osrm");
    refetchGeometries(newDays);
    // Exit edit mode
    setEditMode(false);
    setEditorDirty(false);
    setEditDaysPreview(null);
    setPreviewDays(null);
    setPreviewTargetDay(null);
    setSelectedPOI(null);
    setHighlightDay(null);
  }, [result, refetchGeometries]);

  /** Discard handler — exit edit mode (editor handles its own state). */
  const handleDiscardEdit = useCallback(() => {
    setEditMode(false);
    setEditorDirty(false);
    setEditDaysPreview(null);
    setPreviewDays(null);
    setPreviewTargetDay(null);
    setSelectedPOI(null);
    setHighlightDay(null);
  }, []);

  /** Toggle edit mode with close-guard. */
  const toggleEditMode = useCallback(() => {
    if (editMode) {
      // Trying to exit — check for unsaved changes
      if (editorDirty) {
        const ok = window.confirm(
          t("wizardPage.confirmDiscard")
        );
        if (!ok) return;
      }
      setEditMode(false);
      setEditorDirty(false);
      setSelectedPOI(null);
      setHighlightDay(null);
    } else {
      // Enter edit mode — clear any previous selection
      setSelectedPOI(null);
      setHighlightDay(null);
      setEditMode(true);
    }
  }, [editMode, editorDirty]);

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
    setEditMode(false);
    setEditorDirty(false);
    setSelectedPOI(null);
    setHighlightDay(null);
    setOptimizerResults(null);
    setActiveAlgorithm(null);
  }, []);

  /**
   * Switch the displayed algorithm. The ResultsPanel tabs drive this;
   * we update `result.days/totalDistance/totalDays` so the rest of the
   * app (map, route editor, geometry fetch) re-renders against the
   * new days without the child components needing to know about
   * multi-algorithm state.
   */
  const handleAlgorithmChange = useCallback(
    (algorithm: string) => {
      if (!optimizerResults) return;
      const entry = optimizerResults.find((r) => r?.algorithm === algorithm);
      if (!entry) return;
      setActiveAlgorithm(algorithm);
      setResult((prev) =>
        prev
          ? {
              ...prev,
              days: entry.days,
              totalDistance: entry.totalDistance,
              totalDays: entry.totalDays,
            }
          : prev,
      );
      // Show all days, clear any residual highlight/selection from
      // the previous algorithm (map interactions should not persist
      // across algorithm switches).
      setHiddenDays(new Set());
      setHighlightDay(null);
      setSelectedPOI(null);
      setRouteGeometry(null);
      setRouteSource(null);
      const geometryDays = entry.days.map((d) => ({
        day: d.day,
        stops: d.stops,
      }));
      fetchAllRouteGeometries(geometryDays).then(
        ({ geometries: geo, sources }) => {
          if (geo.size > 0) {
            setRouteGeometry(geo);
            setRouteSource(sources);
          }
        },
      );
    },
    [optimizerResults],
  );

  /**
   * Algorithm id of the best (lowest totalDistance) entry — used by
   * the ResultsPanel to render the trophy badge.
   */
  const winnerAlgorithm = useMemo(() => {
    if (!optimizerResults) return undefined;
    let best: OptimizerResult | null = null;
    for (const r of optimizerResults) {
      if (r === null) continue;
      if (
        best === null ||
        r.totalDistance < best.totalDistance - 1 ||
        (Math.abs(r.totalDistance - best.totalDistance) <= 1 &&
          r.totalDays < best.totalDays)
      ) {
        best = r;
      }
    }
    return best?.algorithm;
  }, [optimizerResults]);

  // ── Steps bar — shown inside the sidebar header ──
  const stepsNode = (
    <WizardSteps
      phases={PHASES}
      currentIdx={currentIdx}
      onStepClick={(i) => setPhase(PHASES[i].key)}
    />
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
                  <div className="text-center text-xs text-gray-400 bg-gray-50 rounded-lg p-2 border border-gray-200">
                    {t("wizardPage.bothAlgorithms")}
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
                    {t("wizardPage.backToEditLocations")}
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
              {!editMode && (
                <ResultsPanel
                days={result.days}
                totalDistance={result.totalDistance}
                totalDays={result.totalDays}
                totalLocations={result.totalLocations}
                hiddenDays={hiddenDays}
                onToggleDay={handleToggleDay}
                onExpandDay={(day) =>
                  setHiddenDays((prev) => {
                    const allDays = result.days.map((d) => d.day);
                    return new Set(allDays.filter((d) => d !== day));
                  })
                }
                expandedDay={sidebarExpandedDay}
                onExpandedDayChange={setSidebarExpandedDay}
                results={optimizerResults ?? undefined}
                activeAlgorithm={activeAlgorithm}
                winnerAlgorithm={winnerAlgorithm}
                onAlgorithmChange={handleAlgorithmChange}
                useConsensus={useConsensus}
                locale={i18n.language}
              />
              )}

              {/* Unreachable POIs — visible only when the API pre-filter excluded any */}
              {result.unreachable && result.unreachable.length > 0 && (
                <UnreachableWarning
                  unreachable={result.unreachable}
                  onRetry={handleOptimize}
                  loading={loading}
                />
              )}

              {/* Edit mode toggle */}
              {result && result.days.length > 0 && (
                <button
                  onClick={toggleEditMode}
                  className={cn(
                    "w-full text-sm py-2 rounded-lg font-medium transition-all",
                    editMode
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  )}
                >
                  {editMode
                    ? (editorDirty
                        ? t("routeEditor.finishEditingWithChanges")
                        : t("routeEditor.finishEditing"))
                    : t("routeEditor.editRoutes")}
                </button>
              )}

              {/* Route editor — mounted only when edit mode is on */}
              {editMode && result && (
                <RouteEditor
                  ref={editorRef}
                  result={result}
                  config={config}
                  locations={locations}
                  matrix={distanceMatrix ?? undefined}
                  selectedPOI={selectedPOI}
                  onPOISelect={(name, lat, lng, day) => {
                    setSelectedPOI({ name, lat, lng, day });
                    setHighlightDay(day);
                    setSidebarExpandedDay(day);
                    setHiddenDays((prev) => {
                      const allDays = result?.days.map((d) => d.day) ?? [];
                      return new Set(allDays.filter((d) => d !== day));
                    });
                  }}
                  onApply={handleApply}
                  onDirtyChange={setEditorDirty}
                  onDiscard={handleDiscardEdit}
                  onWorkingDaysChange={setEditDaysPreview}
                  onClearSelection={() => {
                    setSelectedPOI(null);
                    setHighlightDay(null);
                  }}
                  hiddenDays={hiddenDays}
                  onToggleDay={handleToggleDay}
                />
              )}

              <button
                onClick={() => setHiddenDays(new Set())}
                className="w-full text-xs text-center text-gray-400 hover:text-blue-600 transition-colors py-1 inline-flex items-center justify-center gap-1.5"
              >
                <Eye className="w-3.5 h-3.5" />
                Ver todas las rutas en el mapa
              </button>

              {/* Export — dropdown with format picker */}
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
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setExportOpen(false)}
                    />
                    <div className="absolute bottom-full left-0 right-0 mb-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden divide-y divide-gray-100">
                      <button
                        onClick={() => {
                          downloadRoutePlan({
                            days: result.days,
                            totalDistance: result.totalDistance,
                            totalDays: result.totalDays,
                            totalLocations: result.totalLocations,
                            locale: i18n.language,
                          }, "html");
                          setExportOpen(false);
                        }}
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2"
                      >
                        <span className="text-xs font-mono w-12 font-semibold text-blue-600">HTML</span>
                        <span className="text-gray-700">{t("export.htmlDesc")}</span>
                      </button>
                      <button
                        onClick={() => {
                          downloadRoutePlan({
                            days: result.days,
                            totalDistance: result.totalDistance,
                            totalDays: result.totalDays,
                            totalLocations: result.totalLocations,
                            locale: i18n.language,
                          }, "pdf");
                          setExportOpen(false);
                        }}
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2"
                      >
                        <span className="text-xs font-mono w-12 font-semibold text-red-600">PDF</span>
                        <span className="text-gray-700">{t("export.pdfDesc")}</span>
                      </button>
                      <button
                        onClick={() => {
                          downloadRoutePlan({
                            days: result.days,
                            totalDistance: result.totalDistance,
                            totalDays: result.totalDays,
                            totalLocations: result.totalLocations,
                            locale: i18n.language,
                          }, "docx");
                          setExportOpen(false);
                        }}
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2"
                      >
                        <span className="text-xs font-mono w-12 font-semibold text-blue-800">DOCX</span>
                        <span className="text-gray-700">{t("export.docxDesc")}</span>
                      </button>
                      <button
                        onClick={() => {
                          downloadRoutePlan({
                            days: result.days,
                            totalDistance: result.totalDistance,
                            totalDays: result.totalDays,
                            totalLocations: result.totalLocations,
                            locale: i18n.language,
                          }, "xlsx");
                          setExportOpen(false);
                        }}
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2"
                      >
                        <span className="text-xs font-mono w-12 font-semibold text-green-700">XLSX</span>
                        <span className="text-gray-700">{t("export.xlsxDesc")}</span>
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setPhase("config")}
                  className="btn-secondary w-full text-sm"
                >
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
      {/* ── Locale switcher — top-right, always visible. Lives in the
          wizard header area alongside the step indicators. ── */}
      <div className="fixed top-4 right-4 z-40 bg-white border border-gray-200 rounded-lg shadow-sm px-2 py-1">
        <LocaleSwitcher />
      </div>

      {/* ── Full-screen map ── */}
      <MapView
        data={mapData}
        placementMode={placementMode}
        onPlaceHome={handlePlaceHome}
        onDragHome={handleDragHome}
        selectedPOI={selectedPOI}
        onPOIClick={(lat, lng, day, name) => {
          setSelectedPOI({ name, lat, lng, day });
          setHighlightDay(day);
          setSidebarExpandedDay(day);
          // Aislar el día clickeado — los días ocultos mantienen sus marcadores
          // visibles (chicos, opacos) pero las rutas se atenúan.
          setHiddenDays((prev) => {
            const sourceDays = editMode && editDaysPreview
              ? editDaysPreview
              : result?.days ?? [];
            const allDays = sourceDays.map((d) => d.day);
            return new Set(allDays.filter((d) => d !== day));
          });
        }}
        highlightDay={highlightDay}
        homeDraggable={phase === "config"}
      />

      {/* ── Floating POI action bar (map overlay, edit mode only) ── */}
      {editMode && selectedPOI && (
        <MapPOIActionBar
          poiName={selectedPOI.name}
          currentDay={selectedPOI.day}
          availableDays={availableDays}
          previewTargetDay={previewTargetDay}
          onSelectDay={handlePreviewDay}
          onAccept={handleAcceptMove}
          onCancel={handleCancelMove}
        />
      )}

      {/* ── Floating unassigned POIs panel (view + edit mode) ── */}
      <FloatingUnassignedPanel
        pois={unassignedPOIs}
        onPOIClick={(lat, lng, name) => {
          // Find the day this POI belongs to (if any) and select it
          const sourceRoutes = editDaysPreview ?? result?.days ?? [];
          for (const day of sourceRoutes) {
            for (const s of day.stops) {
              if (!s.isHome && Math.abs(s.lat - lat) < 0.00001 && Math.abs(s.lng - lng) < 0.00001) {
                setSelectedPOI({ name, lat, lng, day: day.day });
                setHighlightDay(day.day);
                return;
              }
            }
          }
          // POI not found in any day — highlight it on the map as unassigned
          setSelectedPOI({ name, lat, lng, day: -1 });
          // No cambiamos highlightDay para no atenuar todas las rutas
        }}
      />

      {/* ── Error toast ── */}
      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-50 border border-red-200 rounded-lg shadow-lg text-sm text-red-700 max-w-md flex items-center gap-2 animate-slide-down"
        >
          <span className="font-medium">Error:</span>
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label={t("ariaLabels.closeError")}
            className="text-red-400 hover:text-red-600 inline-flex items-center"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* ── Sidebar ── */}
      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((o) => !o)}
        title={sidebarTitle}
        sidebarIcon={<Truck className="w-4 h-4 text-blue-600" />}
        subtitle={sidebarSubtitle}
      >
        {/* New optimization button at top when not in upload */}
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
