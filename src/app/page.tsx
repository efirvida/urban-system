"use client";

import { useCallback, useState, useMemo, useRef } from "react";
import {
  Location,
  Config,
  DayRoute,
  ParetoSolution,
  OptimizeResponse,
  NSGAResponse,
  RawFileData,
  ValidatedRow,
  ColumnMapping,
} from "@/types";
import { applyMapping } from "@/utils/parser";
import { cn } from "@/lib/utils";
import { haversineDistance } from "@/utils/haversine";
import { fetchAllRouteGeometries, MatrixProgress } from "@/utils/clientRouting";
import { reoptimizeDay } from "@/utils/routerOptimizer";

// ─── Matrix cache (localStorage) ─────────────────────────────
// Format: { d: Record<"i,j", km>, s: Record<"i,j", "h"|"o"|"g">, t?: string[] }
//   h = Haversine, o = OSRM, g = Geoapify
//   t = keys where Geoapify was already attempted (success or fail)

interface CachedMatrix {
  d: Record<string, number>;
  s: Record<string, string>;
  t?: string[];
  home?: { lat: number; lng: number }; // home coord when cached
}

const MC_PREFIX = "vrp_matrix_";

function locationsHash(locs: Location[]): string {
  const coords = locs.map(l => `${l.lat.toFixed(6)},${l.lng.toFixed(6)}`).sort();
  let h = 5381;
  for (const s of coords.join("|")) h = ((h << 5) + h + s.charCodeAt(0)) | 0;
  return Math.abs(h).toString(36);
}

function loadCachedMatrix(locs: Location[], currentHomeLat?: number, currentHomeLng?: number): { distances: Record<string, number>; geoapifyTried: string[]; cachedHome?: { lat: number; lng: number } } | null {
  try {
    const key = MC_PREFIX + locationsHash(locs);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedMatrix;

    // Check if cached home matches current home (within 300m)
    let homeMatches = false;
    if (parsed.home && currentHomeLat !== undefined && currentHomeLng !== undefined) {
      const d = haversineDistance(currentHomeLat, currentHomeLng, parsed.home.lat, parsed.home.lng);
      homeMatches = d <= 0.3;
    }

    const distances: Record<string, number> = {};
    const sources: Record<string, string> = {};
    const geoapifyTried: string[] = [];

    if (homeMatches && parsed.d) {
      // Home matches → load ALL pairs including home
      for (const k of Object.keys(parsed.d)) {
        distances[k] = parsed.d[k];
        sources[k] = parsed.s[k] || "h";
        if ((parsed.t && parsed.t.includes(k)) || sources[k] === "g" || sources[k] === "x") {
          geoapifyTried.push(k);
        }
      }
    } else {
      // Home changed or missing → load only POI pairs
      for (const k of Object.keys(parsed.d)) {
        if (k.startsWith("0,")) continue;
        distances[k] = parsed.d[k];
        sources[k] = parsed.s[k] || "h";
        if ((parsed.t && parsed.t.includes(k)) || sources[k] === "g" || sources[k] === "x") {
          geoapifyTried.push(k);
        }
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
    console.log(`[Cache] HIT: ${key} (${Object.keys(distances).length} pairs, ${geoapifyTried.length} tried, homeMatch=${homeMatches})`);
    return { distances, geoapifyTried, cachedHome: parsed.home };
  } catch { return null; }
}

function saveCachedMatrix(
  locs: Location[],
  distances: Record<string, number>,
  sources: Record<string, string>,
  geoapifyTried?: string[],
  homeLat?: number,
  homeLng?: number
): void {
  try {
    const key = MC_PREFIX + locationsHash(locs);
    // Clone to avoid mutating the originals
    const toStore: CachedMatrix = { d: { ...distances }, s: { ...sources } };
    if (geoapifyTried && geoapifyTried.length > 0) toStore.t = [...geoapifyTried];
    if (homeLat !== undefined && homeLng !== undefined) toStore.home = { lat: homeLat, lng: homeLng };
    // Keep home pairs in cache so subsequent runs with same home don't need OSRM again
    localStorage.setItem(key, JSON.stringify(toStore));
    const oCount = Object.values(toStore.s).filter(v => v === "o").length;
    const hCount = Object.values(toStore.s).filter(v => v === "h").length;
    const gCount = Object.values(toStore.s).filter(v => v === "g").length;
    console.log(`[Cache] SAVED: ${key} (${Object.keys(toStore.d).length} total pairs, g=${gCount} o=${oCount} h=${hCount})`);
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
import MapView, { MapViewData } from "@/components/MapView";
import Sidebar from "@/components/Sidebar";
import RouteEditor, { RouteEditorHandle } from "@/components/RouteEditor";
import MapPOIActionBar from "@/components/MapPOIActionBar";

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
  /** Floating action bar: target day being previewed (null = no preview). */
  const [previewTargetDay, setPreviewTargetDay] = useState<number | null>(null);
  /** Preview routes — shown on the map while user decides in the action bar. */
  const [previewDays, setPreviewDays] = useState<DayRoute[] | null>(null);
  const [nsgaResult, setNsgaResult] = useState<{
    balanced: ParetoSolution;
    minDistance: ParetoSolution;
  } | null>(null);
  const [autoResult, setAutoResult] = useState<{ days: number; distance: number; maxHours: number; dayRoutes: DayRoute[] } | null>(null);
  const [selectedResult, setSelectedResult] = useState<"best" | "auto" | "balanced" | "minDistance">("best");

  const editorRef = useRef<RouteEditorHandle | null>(null);

  /** Available day numbers — from editDaysPreview or result. */
  const availableDays = useMemo(() => {
    const source = editDaysPreview ?? result?.days ?? [];
    return [...new Set(source.map((d) => d.day))].sort((a, b) => a - b);
  }, [editDaysPreview, result]);

  /** Calculate preview routes when the user selects a target day. */
  const handlePreviewDay = useCallback(
    (targetDay: number | null) => {
      if (!selectedPOI || !editDaysPreview) return;
      setPreviewTargetDay(targetDay);

      if (targetDay === null || targetDay === selectedPOI.day) {
        // Cancel preview — restore the route preview to current working state
        setPreviewDays(null);
        return;
      }

      // Build preview: remove POI from its current day, add to target
      const sourceDay = editDaysPreview.find((d) => d.day === selectedPOI.day);
      const targetDayData = editDaysPreview.find((d) => d.day === targetDay);
      if (!sourceDay || !targetDayData) return;

      const home: Location = { name: "Casa", lat: config.homeLat, lng: config.homeLng };

      const stopsToLocs = (stops: Array<{ name: string; lat: number; lng: number; isHome?: boolean }>) =>
        stops.filter((s) => !s.isHome).map((s) => ({ name: s.name, lat: s.lat, lng: s.lng }));

      const sourcePois = stopsToLocs(sourceDay.stops).filter((s) => s.name !== selectedPOI.name);
      const targetPois = stopsToLocs(targetDayData.stops).concat([
        { name: selectedPOI.name, lat: selectedPOI.lat, lng: selectedPOI.lng },
      ]);

      const newSource = reoptimizeDay(sourcePois, home, config, undefined, sourceDay.day);
      const newTarget = reoptimizeDay(targetPois, home, config, undefined, targetDayData.day);

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
    editorRef.current?.commitMove(
      {
        name: selectedPOI.name,
        lat: selectedPOI.lat,
        lng: selectedPOI.lng,
        fromDay: selectedPOI.day,
      },
      previewTargetDay
    );
    // Clear preview state
    setPreviewDays(null);
    setPreviewTargetDay(null);
    // Update selection to new day
    setSelectedPOI({ ...selectedPOI, day: previewTargetDay });
    setHighlightDay(previewTargetDay);
  }, [selectedPOI, previewTargetDay]);

  const handleCancelMove = useCallback(() => {
    setPreviewDays(null);
    setPreviewTargetDay(null);
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
        locations,
        home,
        hiddenDays,
        // During editing or preview, use straight lines for instant visual feedback
        routingMode: editMode || previewDays ? "haversine" : routingMode,
        routeGeometry: !editMode && !previewDays && routingMode === "osrm" ? routeGeometry ?? undefined : undefined,
      };
    }

    if (phase === "config") {
      return { locations, home };
    }

    return {};
  }, [phase, validatedRows, locations, config, result, hiddenDays, routingMode, routeGeometry, editMode, editDaysPreview, previewDays]);

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
      // ── Paso 1: Construir matriz base (cache → Haversine → OSRM) ──
      // distances: Record<"i,j", km> — lo que se envía al server para optimizar
      // sources: Record<"i,j", "h"|"o"> — para saber qué se calculó
      // geoapifyTried: string[] — pares que ya pasaron por Geoapify

      const all = [{ lat: config.homeLat, lng: config.homeLng }, ...locations];
      const N = all.length;
      const totalPairs = (N * (N - 1)) / 2;
      const hv = (i: number, j: number) => haversineDistance(all[i].lat, all[i].lng, all[j].lat, all[j].lng);

      let distances: Record<string, number> = {};
      let sources: Record<string, string> = {};
      let geoapifyTried: string[] = [];

      // 1a. Intentar cargar del cache
      const cached = loadCachedMatrix(locations, config.homeLat, config.homeLng);
      if (cached) {
        distances = cached.distances;
        geoapifyTried = cached.geoapifyTried;
        for (const k of Object.keys(distances)) {
          sources[k] = geoapifyTried.includes(k) ? "g" : "h";
        }

        // If cache loaded full matrix (home matched), skip rebuild
        const hasHomePairs = Object.keys(distances).length >= totalPairs;
        console.log(`${FLOW} Cache HIT: ${Object.keys(distances).length}/${totalPairs} pairs, ${geoapifyTried.length} tried, homeCached=${hasHomePairs}`);

        if (!hasHomePairs) {
          // Home changed: rebuild home pairs with Haversine + OSRM
          for (let j = 1; j < N; j++) {
            const k = `0,${j}`;
            distances[k] = hv(0, j);
            sources[k] = "h";
          }
          geoapifyTried = geoapifyTried.filter(k => !k.startsWith("0,"));
          console.log(`${FLOW} Home pairs rebuilt: ${N - 1} pairs`);

          // OSRM para pares del home con progreso UI
          const homeOsrm: Array<{ i: number; j: number }> = [];
          for (let j = 1; j < N; j++)
            if (hv(0, j) > 0.5) homeOsrm.push({ i: 0, j });

          if (homeOsrm.length > 0) {
            setOptimizePhase("matrix");
            setMatrixProgress({
              phase: "matrix", stage: `OSRM home: 0/${homeOsrm.length}`,
              current: 0, total: homeOsrm.length, percent: 0,
              etaSeconds: 999, realCount: 0, haversineCount: homeOsrm.length,
            });
            await new Promise(r => setTimeout(r, 50));
            console.log(`${FLOW} OSRM home: ${homeOsrm.length} pares`);
            let oi = 0, osrmOk = 0, osrmFail = 0;
            await Promise.all(Array.from({ length: 4 }, async () => {
              while (oi < homeOsrm.length) {
                const p = homeOsrm[oi++];
                if ((osrmOk + osrmFail) % 10 === 0) await new Promise(r => setTimeout(r, 0));
                try {
                  const c = new AbortController();
                  const t = setTimeout(() => c.abort(), 5000);
                  const url = `https://router.project-osrm.org/route/v1/driving/${all[p.i].lng},${all[p.i].lat};${all[p.j].lng},${all[p.j].lat}?overview=false`;
                  const res = await fetch(url, { signal: c.signal });
                  clearTimeout(t);
                  if (res.ok) {
                    const d = await res.json();
                    if (d.code === "Ok" && d.routes?.length) {
                      const key = `${p.i},${p.j}`;
                      distances[key] = d.routes[0].distance / 1000;
                      sources[key] = "o";
                      osrmOk++;
                    } else osrmFail++;
                  } else osrmFail++;
                } catch { osrmFail++; }
                if ((osrmOk + osrmFail) % 10 === 0) {
                  const done = osrmOk + osrmFail;
                  const elapsed = (Date.now() - t0) / 1000;
                  const speed = done / Math.max(elapsed, 0.1);
                  setMatrixProgress({
                    phase: "matrix", stage: `OSRM home: ${osrmOk} ok · ${osrmFail} fallback`,
                    current: done, total: homeOsrm.length,
                    percent: Math.round((done / homeOsrm.length) * 100),
                    etaSeconds: speed > 0 ? Math.round((homeOsrm.length - done) / speed) : 999,
                    realCount: osrmOk, haversineCount: homeOsrm.length - osrmOk,
                  });
                }
              }
            }));
            console.log(`${FLOW} OSRM home: ${osrmOk} ok, ${osrmFail} fallback`);
          }
        } else {
          console.log(`${FLOW} Home unchanged, skipping OSRM home`);
        }
      }

      // 1b. Cache MISS: construir desde cero con Haversine + OSRM
      if (!cached) {
        console.log(`${FLOW} ── Phase: MATRIX (Haversine + OSRM) ──`);
        setOptimizePhase("matrix");
        await new Promise(r => setTimeout(r, 50));

        // Haversine para TODOS los pares (instántaneo)
        for (let i = 0; i < N; i++) {
          for (let j = i + 1; j < N; j++) {
            const k = `${i},${j}`;
            distances[k] = hv(i, j);
            sources[k] = "h";
          }
        }
        console.log(`${FLOW} Haversine: ${totalPairs} pairs`);

        // OSRM para pares > 0.5km
        const osrmCandidates: Array<{ i: number; j: number }> = [];
        for (let i = 0; i < N; i++)
          for (let j = i + 1; j < N; j++)
            if (hv(i, j) > 0.5) osrmCandidates.push({ i, j });

        const osrmTotal = osrmCandidates.length;
        if (osrmTotal > 0) {
          console.log(`${FLOW} OSRM: ${osrmTotal} pares > 0.5km`);
          const tOsrm = Date.now();
          let oi = 0, osrmOk = 0, osrmFail = 0;

          setMatrixProgress({
            phase: "matrix", stage: `OSRM: 0/${osrmTotal}`,
            current: 0, total: totalPairs, percent: 0,
            etaSeconds: 999, realCount: 0, haversineCount: totalPairs,
          });

          await Promise.all(Array.from({ length: 4 }, async () => {
            while (oi < osrmTotal) {
              const p = osrmCandidates[oi++];
              if ((osrmOk + osrmFail) % 10 === 0) await new Promise(r => setTimeout(r, 0));
              try {
                const c = new AbortController();
                const t = setTimeout(() => c.abort(), 5000);
                const url = `https://router.project-osrm.org/route/v1/driving/${all[p.i].lng},${all[p.i].lat};${all[p.j].lng},${all[p.j].lat}?overview=false`;
                const res = await fetch(url, { signal: c.signal });
                clearTimeout(t);
                if (res.ok) {
                  const d = await res.json();
                  if (d.code === "Ok" && d.routes?.length) {
                    const key = `${p.i},${p.j}`;
                    distances[key] = d.routes[0].distance / 1000;
                    sources[key] = "o";
                    osrmOk++;
                  } else osrmFail++;
                } else osrmFail++;
              } catch { osrmFail++; }

              if ((osrmOk + osrmFail) % 10 === 0) {
                const done = osrmOk + osrmFail;
                const elapsed = (Date.now() - tOsrm) / 1000;
                const speed = done / Math.max(elapsed, 0.1);
                setMatrixProgress({
                  phase: "matrix", stage: `OSRM: ${osrmOk} ok · ${osrmFail} fallback (${done}/${osrmTotal})`,
                  current: done, total: totalPairs,
                  percent: Math.round((done / totalPairs) * 100),
                  etaSeconds: speed > 0 ? Math.round((osrmTotal - done) / speed) : 999,
                  realCount: osrmOk,
                  haversineCount: totalPairs - osrmOk,
                });
              }
            }
          }));
          console.log(`${FLOW} OSRM: ${osrmOk} ok, ${osrmFail} fallback in ${Date.now() - tOsrm}ms`);
        } else {
          console.log(`${FLOW} OSRM: skipped (all pairs ≤ 0.5km)`);
        }

        // Guardar cache inmediatamente (antes de Geoapify)
        saveCachedMatrix(locations, distances, sources, undefined, config.homeLat, config.homeLng);
      }

      // ── Paso 2: Enviar al server (Geoapify mejora los pares que faltan) ──
      setOptimizePhase("algorithm");
      await new Promise(r => setTimeout(r, 100));
      console.log(`${FLOW} ── Phase: ALGORITHM (${algorithm}) ──`);

      const tAlgo = Date.now();
      const apiPayload: Record<string, unknown> = {
        locations, config, algorithm,
        distanceMatrix: distances,
        geoapifyTried,
      };

      console.log(`${FLOW} POST /api/optimize — ${locations.length} locs, ${Object.keys(distances).length} pairs, ${geoapifyTried.length} geoapify-tried`);
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

      // ── Paso 3: Mergear resultados de Geoapify al cache ──
      if (apiData._matrixCache || apiData._geoapifyTried) {
        const geoCache = (apiData._matrixCache as Record<string, number>) || {};
        const geoFailed = (apiData._geoapifyTried as string[]) || [];
        let geoOk = 0;

        // Override con pares exitosos de Geoapify → source="g"
        for (const key of Object.keys(geoCache)) {
          distances[key] = geoCache[key];
          sources[key] = "g";
          geoOk++;
        }

        // Geoapify falló: source se mantiene "o" si OSRM lo calculó, "h" si no
        // Pero ge registramos como "tried" para no llamar a Geoapify devuelta
        for (const key of geoFailed) {
          if (sources[key] !== "o") sources[key] = "x"; // Haversine fallback
          // si sources[key] ya es "o", lo dejamos — OSRM es mejor que Haversine
        }

        const allTried = [...geoapifyTried, ...Object.keys(geoCache), ...geoFailed];
        // Deduplicate
        const triedSet = new Set(allTried);
        saveCachedMatrix(locations, distances, sources, [...triedSet], config.homeLat, config.homeLng);
        console.log(`${FLOW} Geoapify merged: ${geoOk} ok, ${geoFailed.length} failed, tried=${triedSet.size}`);
      }

      // ── Parse combined result (both algorithms ran on server) ──
      let optResult: OptimizeResponse;
      let geometryDays: Array<{ day: number; stops: Array<{ lat: number; lng: number; isHome?: boolean }> }> | undefined;

      const bestDays = apiData.days as unknown as DayRoute[];
      const bestDist = Number(apiData.totalDistance);
      const bestCnt = Number(apiData.totalDays);

      // Store auto result (dayRoutes come from the full response)
      if (apiData._autoDistance) {
        const autoDays = apiData.days as unknown as DayRoute[];
        const autoMaxH = Math.max(...autoDays.map((d: any) => d.totalTime || 0), 0);
        setAutoResult({
          days: Number(apiData._autoDays),
          distance: Number(apiData._autoDistance),
          maxHours: Math.round(autoMaxH * 100) / 100,
          dayRoutes: autoDays,
        });
        console.log(`${FLOW} Auto: ${apiData._autoDays}d · ${apiData._autoDistance}km · ${autoMaxH.toFixed(2)}h max`);
      }

      // Store NSGA2 results (if available)
      const nsga2raw = apiData._nsga2 as Record<string, unknown> | undefined;
      if (nsga2raw) {
        const nsgaBal = nsga2raw.balanced as ParetoSolution;
        const nsgaMin = nsga2raw.minDistance as ParetoSolution;
        console.log(`${FLOW} NSGA2 balanced: ${nsgaBal.days}d · ${nsgaBal.totalDistance}km`);
        console.log(`${FLOW} NSGA2 minDistance: ${nsgaMin.days}d · ${nsgaMin.totalDistance}km`);
        setNsgaResult({ balanced: nsgaBal, minDistance: nsgaMin });
      }

      // Default to best result
      setSelectedResult("best");
      optResult = { days: bestDays, totalDistance: bestDist, totalDays: bestCnt, totalLocations: locations.length };
      geometryDays = bestDays;
      setHiddenDays(new Set(bestDays.slice(1).map((d: any) => d.day)));
      setResult(optResult);
      console.log(`${FLOW} Best: ${bestCnt}d · ${bestDist}km`);

      // ── Source breakdown ──
      {
        const hCount = Object.values(sources).filter(v => v === "h").length;
        const oCount = Object.values(sources).filter(v => v === "o").length;
        const gCount = Object.values(sources).filter(v => v === "g").length;
        const xCount = Object.values(sources).filter(v => v === "x").length;
        console.log(`${FLOW} ── Phase: DONE ──`);
        console.log(`${FLOW} Total elapsed: ${Date.now() - t0}ms`);
        console.log(`${FLOW} Source breakdown: Haversine=${hCount} OSRM=${oCount} GeoapifyOK=${gCount} GeoapifyFail=${xCount} Total=${hCount+oCount+gCount+xCount}`);
      }

      // Fetch route geometries (async, background)
      console.log(`${FLOW} geometryDays:`, geometryDays?.length ?? 0, 'days, result days:', result?.days?.length ?? 0);
      if (geometryDays && geometryDays.length > 0) {
        console.log(`${FLOW} Fetching route geometries for ${geometryDays.length} days...`);
        fetchAllRouteGeometries(geometryDays).then(geo => {
          console.log(`${FLOW} Route geometries: ${geo.size}/${geometryDays.length} days resolved`);
          if (geo.size > 0) {
            console.log(`${FLOW} Setting routeGeometry with ${geo.size} routes`);
            setRouteGeometry(geo);
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
    fetchAllRouteGeometries(days).then(geo => {
      if (geo.size > 0) setRouteGeometry(geo);
    }).catch(err => {
      console.error("[FLOW] Post-Apply geometry fetch error:", err);
    });
  }, []);

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
    // Recompute hidden days based on the new set
    setHiddenDays(new Set(newDays.slice(1).map((d) => d.day)));
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
              {(result) && (() => {
                // Build sorted solutions list — one per algorithm variant
                interface SolItem { id: string; days: number; dist: number; hours: number; routes: DayRoute[]; }
                const maxH = (routes: DayRoute[]) => Math.round(Math.max(...routes.map(r => r.totalTime || 0), 0) * 100) / 100;
                const sols: SolItem[] = [];
                if (autoResult) sols.push({ id: "auto", days: autoResult.days, dist: autoResult.distance, hours: autoResult.maxHours, routes: autoResult.dayRoutes });
                if (nsgaResult?.minDistance) {
                  const m = nsgaResult.minDistance;
                  sols.push({ id: "nsga-m", days: m.days, dist: m.totalDistance, hours: m.maxDayHours, routes: m.dayRoutes });
                }
                if (nsgaResult?.balanced) {
                  const b = nsgaResult.balanced;
                  sols.push({ id: "nsga-b", days: b.days, dist: b.totalDistance, hours: b.maxDayHours, routes: b.dayRoutes });
                }
                // Sort by dist ↑ then days ↑
                sols.sort((a, b) => a.dist - b.dist || a.days - b.days);

                // Auto-select first if needed
                const safeSelected = sols.find(s => s.id === selectedResult) ? selectedResult : sols[0]?.id ?? "auto";
                if (safeSelected !== selectedResult) setSelectedResult(safeSelected as any);

                return (
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-3">
                    <div className="text-xs font-semibold text-blue-700 mb-2">🏆 Soluciones</div>
                    <div className="flex flex-col gap-1">
                      {sols.map((sol, idx) => (
                        <button key={sol.id} onClick={() => {
                          setResult({ days: sol.routes, totalDistance: sol.dist, totalDays: sol.days, totalLocations: locations.length });
                          setHiddenDays(new Set(sol.routes.slice(1).map((d: any) => d.day)));
                          setSelectedResult(sol.id as any);
                        }}
                          className={cn("flex items-center justify-between w-full text-left px-3 py-2 rounded-md text-sm transition-all", safeSelected === sol.id ? "bg-white text-blue-800 shadow-sm border border-blue-300 font-medium" : "text-gray-600 hover:bg-white/70")}>
                          <span className="font-medium">#{idx + 1}</span>
                          <span className="text-xs font-mono text-blue-500">{sol.days}d · {sol.dist.toFixed(0)}km{sol.hours > 0 ? ` · ${sol.hours.toFixed(1)}h/día` : ''}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
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
                  matrix={undefined}
                  selectedPOI={selectedPOI}
                  onPOISelect={(name, lat, lng, day) => {
                    setSelectedPOI({ name, lat, lng, day });
                    setHighlightDay(day);
                  }}
                  onApply={handleApply}
                  onDirtyChange={setEditorDirty}
                  onDiscard={handleDiscardEdit}
                  onWorkingDaysChange={setEditDaysPreview}
                  onClearSelection={() => {
                    setSelectedPOI(null);
                    setHighlightDay(null);
                  }}
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
          // Open the clicked POI's day — use editable days when in edit mode
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
