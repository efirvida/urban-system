"use client";

import { useCallback, useState, useMemo, useRef, useEffect } from "react";
import {
  Location,
  Config,
  DayRoute,
  OptimizerResult,
  OptimizeResponse,
  RawFileData,
  ValidatedRow,
  ColumnMapping,
} from "@/types";
import { applyMapping } from "@/utils/parser";
import { cn } from "@/lib/utils";
import { buildDistanceMatrices, fetchAllRouteGeometries, MatrixProgress, RouteSource } from "@/utils/clientRouting";
import { reoptimizeDay } from "@/utils/routerOptimizer";

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
  const [distanceMatrix, setDistanceMatrix] = useState<Record<string, number> | null>(null);
  const [routingMode, setRoutingMode] = useState<"osrm" | "haversine">("osrm");
  const [routeGeometry, setRouteGeometry] = useState<Map<number, [number, number][]> | null>(null);
  /** Per-day routing source — drives dashed styling on the map. */
  const [routeSource, setRouteSource] = useState<Map<number, RouteSource> | null>(null);
  const [algorithm, setAlgorithm] = useState<"auto" | "nsga2">("nsga2");

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

      const home: Location = { name: "Casa", lat: config.homeLat, lng: config.homeLng };
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
    [selectedPOI, editDaysPreview, config]
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
    setHighlightDay(null);
    setSelectedPOI(null);
    setHiddenDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
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
    const FLOW = "[FLOW]";
    const t0 = Date.now();
    console.log(`${FLOW} ══════ OPTIMIZE START ══════`);
    console.log(`${FLOW} Locations: ${locations.length}, Algorithm: ${algorithm}`);
    console.log(`${FLOW} Config:`, JSON.stringify({ homeLat: config.homeLat, homeLng: config.homeLng, constraintType: config.constraintType, constraintValue: config.constraintValue, avgSpeed: config.avgSpeed, visitTime: config.visitTime }));

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
    setMatrixProgress(null);
    setOptimizePhase("matrix");
    // Yield para que React pinte "Preparando optimización..."
    await new Promise(r => setTimeout(r, 100));

    try {
      // ── Paso 1: Construir matriz base ──
      // The matrix cache (`vrp_matrix_<hash>`) stores a full set of
      // distances for a given location set. The routing cache
      // (`routing/cache.ts`) stores individual legs and is the source
      // of truth when the matrix cache misses or only has POI pairs.
      const N = locations.length + 1; // home + POIs
      const totalPairs = (N * (N - 1)) / 2;
      const fullPairCount = (locations.length * (locations.length + 1)) / 2;

      let distances: Record<string, number> = {};
      const cached = loadCachedMatrix(locations, config.homeLat, config.homeLng);
      const cachedHasFullMatrix = cached && Object.keys(cached.distances).length >= fullPairCount;

      if (cachedHasFullMatrix) {
        // Full matrix cache hit — skip the rebuild entirely.
        distances = cached.distances;
        console.log(`${FLOW} Cache HIT (full): ${Object.keys(distances).length}/${fullPairCount} pairs`);
      } else {
        // Partial or miss — delegate to RoutingService. The service
        // checks the per-leg routing cache first, so the actual network
        // work is limited to the legs that are not yet cached.
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
        // Convert the Map<"i,j", number> the wrapper returns into a
        // Record<"i,j", number> for the optimizer. Unreachable pairs
        // (Infinity) are preserved so the optimizer can reject them.
        for (const [key, value] of osrmMatrix) {
          distances[key] = value;
        }
        const realCount = Object.values(distances).filter((v) => Number.isFinite(v)).length;
        const unreachableCount = totalPairs - realCount;
        console.log(`${FLOW} Matrix built: ${realCount} real, ${unreachableCount} unreachable in ${Date.now() - tBuild}ms`);
        // Persist the full matrix to the localStorage cache so the
        // next run with the same locations can skip the build entirely.
        saveCachedMatrix(locations, distances, config.homeLat, config.homeLng);
      }

      // ── Paso 2: Enviar al server ──
      setOptimizePhase("algorithm");
      await new Promise(r => setTimeout(r, 100));
      console.log(`${FLOW} ── Phase: ALGORITHM (${algorithm}) ──`);

      const tAlgo = Date.now();
      const apiPayload: Record<string, unknown> = {
        locations, config, algorithm,
        distanceMatrix: distances,
        // PR 6 (real-roads-only): feature flag — when true, the API
        // builds a `DistanceMatrix` with per-pair source metadata and
        // passes it through to the optimizer. Default `false` keeps the
        // legacy `Record<string, number>` path bit-identical to pre-PR-6.
        useStrictMatrix: config?.useStrictMatrix ?? false,
      };

      console.log(`${FLOW} POST /api/optimize — ${locations.length} locs, ${Object.keys(distances).length} pairs`);
      const apiRes = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiPayload),
      });

      if (!apiRes.ok) {
        const errData = await apiRes.json().catch(() => ({ error: `HTTP ${apiRes.status}` }));
        throw new Error(errData.error || `Error del servidor (${apiRes.status})`);
      }

      const apiData = await apiRes.json();
      console.log(`${FLOW} API response in ${Date.now() - tAlgo}ms`);

      // ── Parse combined result (registry ran on server) ──
      let optResult: OptimizeResponse;
      let geometryDays: Array<{ day: number; stops: Array<{ lat: number; lng: number; isHome?: boolean }> }> | undefined;

      const bestDays = apiData.days as unknown as DayRoute[];
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
        throw new Error(
          "Ningún optimizador pudo resolver el problema. Probá reducir las ubicaciones o revisar las conexiones de ruta.",
        );
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

      optResult = {
        days: bestDays,
        totalDistance: bestDist,
        totalDays: bestCnt,
        totalLocations: locations.length,
        unreachable: Array.isArray(apiData.unreachable) ? apiData.unreachable : [],
        _meta: apiData._meta,
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
      console.log(`${FLOW} geometryDays:`, geometryDays?.length ?? 0, 'days, result days:', result?.days?.length ?? 0);
      if (geometryDays && geometryDays.length > 0) {
        console.log(`${FLOW} Fetching route geometries for ${geometryDays.length} days...`);
        fetchAllRouteGeometries(geometryDays).then(({ geometries: geo, sources }) => {
          console.log(`${FLOW} Route geometries: ${geo.size}/${geometryDays.length} days resolved`);
          if (geo.size > 0) {
            console.log(`${FLOW} Setting routeGeometry with ${geo.size} routes`);
            setRouteGeometry(geo);
            setRouteSource(sources);
          }
        }).catch((err: any) => {
          console.error(`${FLOW} Route geometry error:`, err);
        });
      } else {
        console.log(`${FLOW} SKIP geometry fetch — geometryDays empty or undefined`);
      }

      setRoutingMode("osrm");
      setOptimizePhase("done");
      setPhase("results");
      setSidebarOpen(true);
    } catch (err) {
      console.error(`${FLOW} ERROR:`, err);
      setError(err instanceof Error ? err.message : "Error inesperado");
      setOptimizePhase("error");
    } finally {
      setLoading(false);
    }
  }, [locations, config, algorithm]);

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

  // ── Refetch OSRM geometry after edits (debounced 800ms) ──
  useEffect(() => {
    if (!editMode || !editDaysPreview || editDaysPreview.length === 0) return;
    const timer = setTimeout(() => {
      refetchGeometries(editDaysPreview);
    }, 800);
    return () => clearTimeout(timer);
  }, [editDaysPreview, editMode]);

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
          "¿Descartar cambios sin guardar?\n\nTienes cambios en el editor que se perderán."
        );
        if (!ok) return;
      }
      setEditMode(false);
      setEditorDirty(false);
    } else {
      // Enter edit mode — clear any previous selection
      setSelectedPOI(null);
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
      setHiddenDays(new Set());
    },
    [optimizerResults],
  );

  /**
   * Algorithm id of the best (lowest totalDistance) entry — used by
   * the ResultsPanel to render the 🏆 badge.
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
                  <div className="text-center text-xs text-gray-400 bg-gray-50 rounded-lg p-2 border border-gray-200">
                    🧬 Se ejecutan ambos algoritmos — se muestra el mejor resultado
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
                routingLabel="🚗 Rutas optimizadas"
                expandedDay={sidebarExpandedDay}
                onExpandedDayChange={setSidebarExpandedDay}
                results={optimizerResults ?? undefined}
                activeAlgorithm={activeAlgorithm}
                winnerAlgorithm={winnerAlgorithm}
                onAlgorithmChange={handleAlgorithmChange}
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
                    ? (editorDirty ? "Terminar edición (con cambios)" : "Terminar edición")
                    : "Editar rutas"}
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
          setHighlightDay(-1);
        }}
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
