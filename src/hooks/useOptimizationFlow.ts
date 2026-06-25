"use client";

import { useCallback, useEffect, useState } from "react";
import type { TFunction } from "i18next";
import {
  isDayRouteArray,
  isOptimizeMeta,
  type Config,
  type DayRoute,
  type Location,
  type OptimizeResponse,
  type OptimizerResult,
} from "@/types";
import { buildDistanceMatrices, fetchAllRouteGeometries, MatrixProgress, RouteSource } from "@/utils/clientRouting";

/** Sub-phase of the optimization pipeline surfaced to the progress UI. */
export type OptimizePhase = "idle" | "matrix" | "algorithm" | "done" | "error";

interface UseOptimizationFlowParams {
  locations: Location[];
  config: Config;
  algorithm: "auto" | "nsga2";
  /** i18n function used for fallback error messages. */
  t: TFunction;
  /**
   * Toast callback — `(msg, { kind }) => void`. When omitted, errors
   * only land on the in-page `error` state and a console.error line.
   */
  notify?: (msg: string, kind: "error" | "info") => void;
  /**
   * Called when the optimization completes successfully. Used by the
   * page to transition the wizard to the `results` phase and open
   * the sidebar.
   */
  onSuccess?: () => void;
}

export interface OptimizationFlow {
  // ── State ──
  loading: boolean;
  error: string | null;
  setError: (msg: string | null) => void;
  result: OptimizeResponse | null;
  optimizerResults: (OptimizerResult | null)[] | null;
  activeAlgorithm: string | null;
  routingMode: RouteSource | "haversine";
  routeGeometry: Map<number, [number, number][]> | null;
  routeSource: Map<number, RouteSource> | null;
  distanceMatrix: Record<string, number> | null;
  optimizePhase: OptimizePhase;
  matrixProgress: MatrixProgress | null;
  useConsensus: boolean;
  hiddenDays: Set<number>;
  /** Best algorithm id (lowest totalDistance) for trophy badge in UI. */
  winnerAlgorithm: string | undefined;

  // ── Handlers ──
  handleOptimize: () => Promise<void>;
  refetchGeometries: (days: DayRoute[]) => void;
  handleAlgorithmChange: (algorithm: string) => void;
  handleApply: (newDays: DayRoute[]) => void;
  handleToggleDay: (day: number) => void;
  handleExpandDay: (day: number) => void;
  handleReset: () => void;
  /** Direct setter for `hiddenDays` — used by the "show all" button
   *  in the results sidebar to wipe a per-day isolation. */
  setHiddenDays: React.Dispatch<React.SetStateAction<Set<number>>>;
}

// ─── Local helpers ────────────────────────────────────────────

interface CachedMatrix {
  d: Record<string, number>;
  home?: { lat: number; lng: number };
}

const MC_PREFIX = "vrp_matrix_";

function locationsHash(locs: Location[]): string {
  const coords = locs.map((l) => `${l.lat.toFixed(6)},${l.lng.toFixed(6)}`).sort();
  let h = 5381;
  for (const s of coords.join("|")) h = ((h << 5) + h + s.charCodeAt(0)) | 0;
  return Math.abs(h).toString(36);
}

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
    let homeMatches = false;
    if (parsed.home && currentHomeLat !== undefined && currentHomeLng !== undefined) {
      const d = Math.abs(currentHomeLat - parsed.home.lat) + Math.abs(currentHomeLng - parsed.home.lng);
      homeMatches = d <= 0.005;
    }
    const distances: Record<string, number> = {};
    if (homeMatches && parsed.d) {
      for (const k of Object.keys(parsed.d)) distances[k] = parsed.d[k]!;
    } else {
      for (const k of Object.keys(parsed.d)) {
        if (k.startsWith("0,")) continue;
        distances[k] = parsed.d[k]!;
      }
    }
    const expectedPairs = homeMatches
      ? (locs.length * (locs.length + 1)) / 2
      : (locs.length * (locs.length - 1)) / 2;
    if (Object.keys(distances).length !== expectedPairs) {
      localStorage.removeItem(key);
      return null;
    }
    return { distances, cachedHome: parsed.home };
  } catch {
    return null;
  }
}

function saveCachedMatrix(
  locs: Location[],
  distances: Record<string, number>,
  homeLat?: number,
  homeLng?: number,
): void {
  try {
    const key = MC_PREFIX + locationsHash(locs);
    const toStore: CachedMatrix = { d: { ...distances } };
    if (homeLat !== undefined && homeLng !== undefined) {
      toStore.home = { lat: homeLat, lng: homeLng };
    }
    localStorage.setItem(key, JSON.stringify(toStore));
  } catch (err) {
    console.warn("[Cache] Failed to save:", err);
  }
}

// ─── Hook ─────────────────────────────────────────────────────

export function useOptimizationFlow({
  locations,
  config,
  algorithm,
  t,
  notify,
  onSuccess,
}: UseOptimizationFlowParams): OptimizationFlow {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [optimizerResults, setOptimizerResults] = useState<(OptimizerResult | null)[] | null>(null);
  const [activeAlgorithm, setActiveAlgorithm] = useState<string | null>(null);
  const [routingMode, setRoutingMode] = useState<RouteSource | "haversine">("osrm");
  const [routeGeometry, setRouteGeometry] = useState<Map<number, [number, number][]> | null>(null);
  const [routeSource, setRouteSource] = useState<Map<number, RouteSource> | null>(null);
  const [distanceMatrix, setDistanceMatrix] = useState<Record<string, number> | null>(null);
  const [optimizePhase, setOptimizePhase] = useState<OptimizePhase>("idle");
  const [matrixProgress, setMatrixProgress] = useState<MatrixProgress | null>(null);
  const [useConsensus, setUseConsensus] = useState(false);
  const [hiddenDays, setHiddenDays] = useState<Set<number>>(new Set());

  // ── Auto-dismiss legacy error state after 6s (banner is still
  //    rendered by the page; toasts handle the rest). ──
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  const handleOptimize = useCallback(async () => {
    const FLOW = "[FLOW]";
    const t0 = Date.now();
    console.log(`${FLOW} ══════ OPTIMIZE START ══════`);
    console.log(`${FLOW} Locations: ${locations.length}, Algorithm: ${algorithm}`);

    if (locations.length === 0) {
      const msg = t("wizard.errors.noValidLocations");
      setError(msg);
      notify?.(msg, "error");
      return;
    }
    if (!config.homeLat || !config.homeLng) {
      const msg = t("wizard.errors.configureHome");
      setError(msg);
      notify?.(msg, "error");
      return;
    }

    setLoading(true);
    setError(null);
    setMatrixProgress(null);
    setOptimizePhase("matrix");
    await new Promise((r) => setTimeout(r, 100));

    try {
      // ── Step 1: Distance matrix ──
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
        } else {
          setOptimizePhase("matrix");
          await new Promise((r) => setTimeout(r, 50));
          const { osrmMatrix } = await buildDistanceMatrices(
            config.homeLat,
            config.homeLng,
            locations,
            (p) => setMatrixProgress(p),
          );
          for (const [key, value] of osrmMatrix) distances[key] = value;
          saveCachedMatrix(locations, distances, config.homeLat, config.homeLng);
          void totalPairs;
        }
      } else {
        setOptimizePhase("matrix");
        await new Promise((r) => setTimeout(r, 50));
      }

      if (!USE_CONSENSUS_MATRIX) {
        setOptimizePhase("algorithm");
        await new Promise((r) => setTimeout(r, 100));
      }

      const apiPayload: Record<string, unknown> = {
        locations,
        config,
        algorithm,
        distanceMatrix: distances,
        // `useStrictMatrix` was removed from the request contract — the
        // server always builds a `DistanceMatrix` now. The field is
        // silently ignored when sent for back-compat.
        useConsensus: USE_CONSENSUS_MATRIX,
      };

      const apiRes = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiPayload),
      });

      let apiData: Record<string, unknown> = {};

      if (USE_CONSENSUS_MATRIX) {
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
              if (e instanceof SyntaxError) return;
              throw e;
            }
          };
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) processLine(line);
          }
          if (buffer.trim()) processLine(buffer);
          if (!apiData) throw new Error("No result event in stream");
        } else {
          if (!apiRes.ok) {
            const errData = await apiRes.json().catch(() => ({ error: `HTTP ${apiRes.status}` }));
            throw new Error(errData.error || `Error del servidor (${apiRes.status})`);
          }
          apiData = await apiRes.json();
        }
        setOptimizePhase("algorithm");
        await new Promise((r) => setTimeout(r, 50));
      } else {
        if (!apiRes.ok) {
          const errData = await apiRes.json().catch(() => ({ error: `HTTP ${apiRes.status}` }));
          throw new Error(errData.error || `Error del servidor (${apiRes.status})`);
        }
        apiData = await apiRes.json();
      }

      // ── Parse combined result (registry ran on server) ──
      // Use the shared guards from @/types so the shape is identical
      // to other consumers and `apiMeta` lands as the right union.

      const bestDays: DayRoute[] = isDayRouteArray(apiData.days) ? apiData.days : [];
      const bestDist = Number(apiData.totalDistance);
      const bestCnt = Number(apiData.totalDays);

      const allResults = (apiData.results ?? []) as (OptimizerResult | null)[];
      let winner: OptimizerResult | null = null;
      for (const r of allResults) {
        if (r === null) continue;
        if (
          winner === null ||
          r.totalDistance < winner.totalDistance - 1 ||
          (Math.abs(r.totalDistance - winner.totalDistance) <= 1 && r.totalDays < winner.totalDays)
        ) {
          winner = r;
        }
      }
      if (!winner) throw new Error(t("wizard.errors.noResult"));

      setOptimizerResults(allResults);
      setActiveAlgorithm(winner.algorithm);
      const apiMeta = isOptimizeMeta(apiData._meta) ? apiData._meta : undefined;
      setUseConsensus(apiMeta?.useConsensus === true);

      const optResult: OptimizeResponse = {
        days: bestDays,
        totalDistance: bestDist,
        totalDays: bestCnt,
        totalLocations: locations.length,
        unreachable: Array.isArray(apiData.unreachable) ? apiData.unreachable : [],
        _meta: apiMeta,
      };
      setHiddenDays(new Set());
      setDistanceMatrix(distances);
      setResult(optResult);

      const geometryDays = bestDays;
      if (geometryDays && geometryDays.length > 0) {
        fetchAllRouteGeometries(geometryDays)
          .then(({ geometries: geo, sources }) => {
            if (geo.size > 0) {
              setRouteGeometry(geo);
              setRouteSource(sources);
            }
          })
          .catch((err: unknown) => {
            const msg = t("wizard.errors.routeGeometry");
            notify?.(msg, "error");
            setError(msg);
            console.error("[FLOW] Route geometry error:", err);
          });
      }

      const bestSource: RouteSource | "haversine" = (() => {
        if (!routeSource || routeSource.size === 0) return "osrm";
        for (const s of routeSource.values()) {
          if (s !== "haversine") return s;
        }
        return "haversine";
      })();
      setRoutingMode(bestSource);
      setOptimizePhase("done");
      console.log(`${FLOW} Total elapsed: ${Date.now() - t0}ms`);
      onSuccess?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("wizard.errors.unexpectedError");
      notify?.(msg, "error");
      setError(msg);
      setOptimizePhase("error");
      console.error(`${FLOW} ERROR:`, err);
    } finally {
      setLoading(false);
    }
    // routeSource is intentionally omitted from deps — we read the
    // current value inside the closure but the loop result is derived
    // from the geometry fetch promise, not from the prior state.
  }, [locations, config, algorithm, routeSource, t, notify, onSuccess]);

  const refetchGeometries = useCallback(
    (days: DayRoute[]) => {
      if (days.length === 0) return;
      fetchAllRouteGeometries(days)
        .then(({ geometries: geo, sources }) => {
          if (geo.size > 0) {
            setRouteGeometry(geo);
            setRouteSource(sources);
          }
        })
        .catch((err) => {
          const msg = t("wizard.errors.routeGeometry");
          notify?.(msg, "error");
          setError(msg);
          console.error("[FLOW] Post-Apply geometry fetch error:", err);
        });
    },
    [t, notify],
  );

  const handleAlgorithmChange = useCallback(
    (nextAlgorithm: string) => {
      if (!optimizerResults) return;
      const entry = optimizerResults.find((r) => r?.algorithm === nextAlgorithm);
      if (!entry) return;
      setActiveAlgorithm(nextAlgorithm);
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
      setRouteGeometry(null);
      setRouteSource(null);
      const geometryDays = entry.days.map((d) => ({ day: d.day, stops: d.stops }));
      fetchAllRouteGeometries(geometryDays).then(({ geometries: geo, sources }) => {
        if (geo.size > 0) {
          setRouteGeometry(geo);
          setRouteSource(sources);
        }
      });
    },
    [optimizerResults],
  );

  const handleApply = useCallback(
    (newDays: DayRoute[]) => {
      setResult((prev) => {
        if (!prev) return prev;
        const newTotalDistance = newDays.reduce((s, d) => s + d.totalDistance, 0);
        return {
          ...prev,
          days: newDays,
          totalDistance: Math.round(newTotalDistance * 100) / 100,
          totalDays: newDays.length,
        };
      });
      setHiddenDays(new Set());
      setRoutingMode("osrm");
      refetchGeometries(newDays);
    },
    [refetchGeometries],
  );

  const handleToggleDay = useCallback((day: number) => {
    setHiddenDays((prev) => {
      const wasHidden = prev.has(day);
      const next = new Set(prev);
      if (wasHidden) next.delete(day);
      else next.add(day);
      return next;
    });
  }, []);

  const handleExpandDay = useCallback((day: number) => {
    setHiddenDays((prev) => {
      // The "expand" semantic shows ONLY this day on the map.
      // Caller is expected to also pass `expandedDay` to the panel.
      void prev;
      return new Set([day].length ? [day] : []);
    });
  }, []);

  const handleReset = useCallback(() => {
    setResult(null);
    setError(null);
    setOptimizerResults(null);
    setActiveAlgorithm(null);
    setRouteGeometry(null);
    setRouteSource(null);
    setDistanceMatrix(null);
    setOptimizePhase("idle");
    setMatrixProgress(null);
    setUseConsensus(false);
    setHiddenDays(new Set());
    setRoutingMode("osrm");
  }, []);

  const winnerAlgorithm = (() => {
    if (!optimizerResults) return undefined;
    let best: OptimizerResult | null = null;
    for (const r of optimizerResults) {
      if (r === null) continue;
      if (
        best === null ||
        r.totalDistance < best.totalDistance - 1 ||
        (Math.abs(r.totalDistance - best.totalDistance) <= 1 && r.totalDays < best.totalDays)
      ) {
        best = r;
      }
    }
    return best?.algorithm;
  })();

  return {
    loading,
    error,
    setError,
    result,
    optimizerResults,
    activeAlgorithm,
    routingMode,
    routeGeometry,
    routeSource,
    distanceMatrix,
    optimizePhase,
    matrixProgress,
    useConsensus,
    hiddenDays,
    winnerAlgorithm,
    handleOptimize,
    refetchGeometries,
    handleAlgorithmChange,
    handleApply,
    handleToggleDay,
    handleExpandDay,
    handleReset,
    setHiddenDays,
  };
}
