"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { MapPin } from "lucide-react";
import { DayRoute, Location, Config, EditMutation } from "@/types";
import { reoptimizeDay } from "@/utils/routerOptimizer";
import { cn, getRouteColor } from "@/lib/utils";

import EditorToolbar from "./EditorToolbar";
import DayColumn from "./DayColumn";
import UnassignedPool from "./UnassignedPool";

interface RouteEditorProps {
  /** The current optimization result — used as the snapshot seed. */
  result: { days: DayRoute[]; totalDistance: number; totalDays: number; totalLocations: number };
  config: Config;
  /** All master locations — used to identify unassigned POIs. */
  locations: Location[];
  /** Precomputed distance matrix (optional). Currently unused by
   *  reoptimizeDay which uses Haversine. Kept for future use. */
  matrix?: Record<string, number>;
  /** Currently-selected POI on the map (for highlight). */
  selectedPOI?: { lat: number; lng: number; day: number; name: string } | null;
  /** Called when the user clicks a stop in the editor — parent
   *  typically syncs this with the map. */
  onPOISelect?: (name: string, lat: number, lng: number, day: number) => void;
  /** Called when the user clicks Apply. The parent should write
   *  `newDays` to its result and exit edit mode. */
  onApply: (newDays: DayRoute[]) => void;
  /** Called when dirty state changes — used by the parent to gate
   *  the "Terminar edición" button with a confirm dialog. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Called when the user clicks Discard. Parent typically just closes
   *  edit mode (the editor restores its own working state). */
  onDiscard: () => void;
  /** Called whenever workingDays changes — parent uses this to
   *  update the map with the current editable routes. */
  onWorkingDaysChange?: (days: DayRoute[]) => void;
  /** Called when the user clears the POI selection (e.g. after moving it). */
  onClearSelection?: () => void;
}

const UNDO_CAP = 20;
const POOL_DAY = 0; // 0 = unassigned pool in mutation metadata

/**
 * RouteEditor — full in-place editor for the optimized result.
 *
 * Owns the EditSession (snapshot + workingDays + unassigned + undo /
 * redo stacks) and exposes Apply / Discard / Undo / Redo via callbacks.
 *
 * Drag-and-drop rules (per spec):
 *  - Cross-day drop  → reoptimize BOTH source and target day.
 *  - Pool → day      → reoptimize the target day.
 *  - Day → pool      → reoptimize the source day.
 *  - Within-day drop → ignored. The day is reoptimized regardless of
 *    drop index, so manual reordering is impossible.
 */
export default function RouteEditor({
  result,
  config,
  locations,
  matrix,
  selectedPOI,
  onPOISelect,
  onApply,
  onDirtyChange,
  onDiscard,
  onWorkingDaysChange,
  onClearSelection,
}: RouteEditorProps) {
  // ── Session state (initialized from props on first mount) ──
  const snapshotRef = useRef<DayRoute[] | null>(null);
  const initRef = useRef(false);
  const [workingDays, setWorkingDays] = useState<DayRoute[]>([]);
  const [unassigned, setUnassigned] = useState<Location[]>([]);
  const [undoStack, setUndoStack] = useState<EditMutation[]>([]);
  const [redoStack, setRedoStack] = useState<EditMutation[]>([]);
  const [dirty, setDirty] = useState(false);
  const [activeDrag, setActiveDrag] = useState<{
    name: string;
    color?: string;
  } | null>(null);

  // ── Init working state from result (once) ──
  useEffect(() => {
    if (snapshotRef.current !== null) return; // already initialized
    const seed = deepCloneDays(result.days);
    snapshotRef.current = seed;
    setWorkingDays(seed);
    setUnassigned(computeUnassigned(seed, locations));
    setUndoStack([]);
    setRedoStack([]);
    setDirty(false);
    initRef.current = true;
    onWorkingDaysChange?.(seed);
  }, [result.days, locations]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Notify parent of dirty changes ──
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // ── Notify parent of workingDays changes (for map preview) ──
  useEffect(() => {
    if (!initRef.current) return;
    onWorkingDaysChange?.(workingDays);
  }, [workingDays, onWorkingDaysChange]);

  // ── Highlighted day = selected POI's day (read-only prop) ──
  const highlightedDay = useMemo(
    () => (selectedPOI ? selectedPOI.day : null),
    [selectedPOI]
  );

  // ── Home reference used by reoptimizeDay ──
  const home: Location = useMemo(
    () => ({ name: "Casa", lat: config.homeLat, lng: config.homeLng }),
    [config.homeLat, config.homeLng]
  );

  // ── dnd-kit sensors ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // ── Helpers ──
  const pushUndo = useCallback(
    (mut: Omit<EditMutation, "priorDays" | "priorUnassigned">) => {
      setUndoStack((prev) => {
        const next = [
          ...prev,
          {
            ...mut,
            priorDays: deepCloneDays(workingDays),
            priorUnassigned: unassigned.map((u) => ({ ...u })),
          },
        ];
        return next.length > UNDO_CAP ? next.slice(-UNDO_CAP) : next;
      });
      setRedoStack([]);
      setDirty(true);
    },
    [workingDays, unassigned]
  );

  // ── Drag end ──
  const handleDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as
      | { kind: "stop" | "pool-item"; name: string }
      | undefined;
    if (data?.name) setActiveDrag({ name: data.name });
  };

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      setActiveDrag(null);
      const active = e.active.data.current as
        | { kind: "stop" | "pool-item"; name: string; lat: number; lng: number; dayIndex: number }
        | undefined;
      const over = e.over?.data.current as
        | { kind: "day" | "pool"; dayIndex?: number; dayNumber?: number }
        | undefined;
      if (!active || !over) return;

      // ── Case 1: stop dragged to a different day ──
      if (active.kind === "stop" && over.kind === "day" && over.dayIndex !== undefined) {
        const fromDayIdx = active.dayIndex;
        const toDayIdx = over.dayIndex;
        if (fromDayIdx === toDayIdx) return; // within-day drop — ignore

        // Remove from source, add to target, reoptimize both
        const sourceDay = workingDays[fromDayIdx];
        const targetDay = workingDays[toDayIdx];
        if (!sourceDay || !targetDay) return;

        const sourcePois = stopsToLocations(
          sourceDay.stops.filter((s) => !s.isHome)
        ).filter((p) => p.name !== active.name);
        const targetPois = stopsToLocations(
          targetDay.stops.filter((s) => !s.isHome)
        ).concat([{ name: active.name, lat: active.lat, lng: active.lng }]);

        const newSource = reoptimizeDay(sourcePois, home, config, matrix, sourceDay.day);
        const newTarget = reoptimizeDay(targetPois, home, config, matrix, targetDay.day);

        pushUndo({
          type: "move",
          poiName: active.name,
          fromDay: sourceDay.day,
          toDay: targetDay.day,
        });

        setWorkingDays((prev) => {
          const next = [...prev];
          next[fromDayIdx] = newSource;
          next[toDayIdx] = newTarget;
          return next;
        });
        return;
      }

      // ── Case 2: stop dragged to the unassigned pool ──
      if (active.kind === "stop" && over.kind === "pool") {
        const fromDayIdx = active.dayIndex;
        const sourceDay = workingDays[fromDayIdx];
        if (!sourceDay) return;

        const sourcePois = stopsToLocations(
          sourceDay.stops.filter((s) => !s.isHome)
        ).filter((p) => p.name !== active.name);

        const newSource = reoptimizeDay(sourcePois, home, config, matrix, sourceDay.day);

        pushUndo({
          type: "remove",
          poiName: active.name,
          fromDay: sourceDay.day,
          toDay: POOL_DAY,
        });

        setWorkingDays((prev) => {
          const next = [...prev];
          next[fromDayIdx] = newSource;
          return next;
        });
        setUnassigned((prev) => [
          ...prev,
          { name: active.name, lat: active.lat, lng: active.lng },
        ]);
        return;
      }

      // ── Case 3: pool item dragged onto a day ──
      if (active.kind === "pool-item" && over.kind === "day" && over.dayIndex !== undefined) {
        const toDayIdx = over.dayIndex;
        const targetDay = workingDays[toDayIdx];
        if (!targetDay) return;

        const targetPois = stopsToLocations(
          targetDay.stops.filter((s) => !s.isHome)
        ).concat([{ name: active.name, lat: active.lat, lng: active.lng }]);

        const newTarget = reoptimizeDay(targetPois, home, config, matrix, targetDay.day);

        pushUndo({
          type: "add",
          poiName: active.name,
          fromDay: POOL_DAY,
          toDay: targetDay.day,
        });

        setWorkingDays((prev) => {
          const next = [...prev];
          next[toDayIdx] = newTarget;
          return next;
        });
        setUnassigned((prev) =>
          prev.filter(
            (p) =>
              !(
                p.name === active.name &&
                p.lat === active.lat &&
                p.lng === active.lng
              )
          )
        );
        return;
      }

      // ── Case 4: pool item dropped on pool — no-op ──
      if (active.kind === "pool-item" && over.kind === "pool") return;
    },
    [workingDays, home, config, matrix, pushUndo]
  );

  // ── Undo ──
  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const mut = prev[prev.length - 1];
      // Push CURRENT state to redo stack
      setRedoStack((r) => [
        ...r,
        {
          type: mut.type,
          poiName: mut.poiName,
          fromDay: mut.toDay,
          toDay: mut.fromDay,
          priorDays: deepCloneDays(workingDays),
          priorUnassigned: unassigned.map((u) => ({ ...u })),
        },
      ]);
      // Restore prior state
      setWorkingDays(deepCloneDays(mut.priorDays));
      setUnassigned(mut.priorUnassigned.map((u) => ({ ...u })));
      return prev.slice(0, -1);
    });
  }, [workingDays, unassigned]);

  // ── Redo ──
  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const mut = prev[prev.length - 1];
      setUndoStack((u) => [
        ...u,
        {
          type: mut.type,
          poiName: mut.poiName,
          fromDay: mut.toDay,
          toDay: mut.fromDay,
          priorDays: deepCloneDays(workingDays),
          priorUnassigned: unassigned.map((u) => ({ ...u })),
        },
      ]);
      setWorkingDays(deepCloneDays(mut.priorDays));
      setUnassigned(mut.priorUnassigned.map((u) => ({ ...u })));
      return prev.slice(0, -1);
    });
  }, [workingDays, unassigned]);

  // ── Apply ──
  const handleApply = useCallback(() => {
    if (!dirty) return;
    onApply(deepCloneDays(workingDays));
  }, [dirty, workingDays, onApply]);

  // ── Discard (parent's onDiscard is a no-op for state — editor
  //    restores internally. We still call onDiscard so the parent
  //    can decide to exit edit mode.) ──
  const handleDiscard = useCallback(() => {
    if (!dirty) {
      onDiscard();
      return;
    }
    const snap = snapshotRef.current;
    if (snap) {
      setWorkingDays(deepCloneDays(snap));
      setUnassigned(computeUnassigned(snap, locations));
    }
    setUndoStack([]);
    setRedoStack([]);
    setDirty(false);
    onDiscard();
  }, [dirty, locations, onDiscard]);

  // ── Remove a stop from a day (X button on a StopItem) ──
  const handleRemoveStop = useCallback(
    (dayNumber: number, stopName: string, lat: number, lng: number) => {
      const dayIdx = workingDays.findIndex((d) => d.day === dayNumber);
      if (dayIdx === -1) return;
      const day = workingDays[dayIdx];
      const newPois = stopsToLocations(day.stops.filter((s) => !s.isHome)).filter(
        (p) => p.name !== stopName
      );
      const newDay = reoptimizeDay(newPois, home, config, matrix, day.day);
      pushUndo({
        type: "remove",
        poiName: stopName,
        fromDay: day.day,
        toDay: POOL_DAY,
      });
      setWorkingDays((prev) => {
        const next = [...prev];
        next[dayIdx] = newDay;
        return next;
      });
      setUnassigned((prev) => [
        ...prev,
        { name: stopName, lat, lng },
      ]);
    },
    [workingDays, home, config, matrix, pushUndo]
  );

  // ── Stop click → notify parent (for map highlight) ──
  const handleStopClick = useCallback(
    (dayNumber: number, name: string, lat: number, lng: number) => {
      onPOISelect?.(name, lat, lng, dayNumber);
    },
    [onPOISelect]
  );

  // ── Move POI to a different day (from the action bar) ──
  const handleMovePOI = useCallback(
    (poiName: string, lat: number, lng: number, fromDayNumber: number, toDayNumber: number | null) => {
      if (toDayNumber === fromDayNumber) return;
      const fromDayIdx = workingDays.findIndex((d) => d.day === fromDayNumber);
      if (fromDayIdx === -1) return;

      if (toDayNumber === null) {
        // Move to unassigned
        const sourceDay = workingDays[fromDayIdx];
        const sourcePois = stopsToLocations(
          sourceDay.stops.filter((s) => !s.isHome)
        ).filter((p) => p.name !== poiName);
        const newSource = reoptimizeDay(sourcePois, home, config, matrix, sourceDay.day);
        pushUndo({ type: "remove", poiName, fromDay: fromDayNumber, toDay: 0 });
        setWorkingDays((prev) => {
          const next = [...prev];
          next[fromDayIdx] = newSource;
          return next;
        });
        setUnassigned((prev) => [...prev, { name: poiName, lat, lng }]);
        onClearSelection?.();
        return;
      }

      // Move to another day
      const toDayIdx = workingDays.findIndex((d) => d.day === toDayNumber);
      if (toDayIdx === -1) return;

      const sourceDay = workingDays[fromDayIdx];
      const targetDay = workingDays[toDayIdx];
      const sourcePois = stopsToLocations(sourceDay.stops.filter((s) => !s.isHome))
        .filter((p) => p.name !== poiName);
      const targetPois = stopsToLocations(targetDay.stops.filter((s) => !s.isHome))
        .concat([{ name: poiName, lat, lng }]);

      const newSource = reoptimizeDay(sourcePois, home, config, matrix, sourceDay.day);
      const newTarget = reoptimizeDay(targetPois, home, config, matrix, targetDay.day);

      pushUndo({ type: "move", poiName, fromDay: fromDayNumber, toDay: toDayNumber });
      setWorkingDays((prev) => {
        const next = [...prev];
        next[fromDayIdx] = newSource;
        next[toDayIdx] = newTarget;
        return next;
      });
      // Update selection to the new day
      onPOISelect?.(poiName, lat, lng, toDayNumber);
    },
    [workingDays, home, config, matrix, pushUndo, onPOISelect, onClearSelection]
  );

  const availableDays = useMemo(
    () => workingDays.map((d) => d.day).sort((a, b) => a - b),
    [workingDays]
  );

  // ── Render ──
  return (
    <div className="space-y-3">
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <EditorToolbar
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          hasChanges={dirty}
          onApply={handleApply}
          onDiscard={handleDiscard}
          onUndo={handleUndo}
          onRedo={handleRedo}
        />

        {/* ── POI action bar: appears when a POI is selected in edit mode ── */}
        {selectedPOI && (
          <div className="rounded-lg p-2.5 border border-blue-200 bg-blue-50/80">
            <div className="flex items-center gap-1.5 text-xs flex-wrap">
              <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span className="font-semibold text-blue-800 truncate max-w-[120px]">
                {selectedPOI.name}
              </span>
              <span className="text-blue-400">·</span>
              <span className="text-blue-600 font-medium">Día {selectedPOI.day}</span>
              <span className="text-blue-400 ml-1">→</span>
              <div className="flex gap-1 flex-wrap">
                {availableDays.map((d) => (
                  <button
                    key={d}
                    onClick={() =>
                      handleMovePOI(
                        selectedPOI.name,
                        selectedPOI.lat,
                        selectedPOI.lng,
                        selectedPOI.day,
                        d === selectedPOI.day ? null : d
                      )
                    }
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                      d === selectedPOI.day
                        ? "bg-blue-100 text-blue-300 cursor-not-allowed"
                        : "bg-white text-blue-700 hover:bg-blue-100 border border-blue-200"
                    )}
                    disabled={d === selectedPOI.day}
                    title={d === selectedPOI.day ? "Ya está en este día" : `Mover a Día ${d}`}
                  >
                    Día {d}
                  </button>
                ))}
                <button
                  onClick={() =>
                    handleMovePOI(
                      selectedPOI.name,
                      selectedPOI.lat,
                      selectedPOI.lng,
                      selectedPOI.day,
                      null
                    )
                  }
                  className="px-2 py-0.5 rounded text-[10px] font-medium bg-white text-amber-700 hover:bg-amber-50 border border-amber-200 transition-colors"
                  title="Quitar de la ruta"
                >
                  Sin ruta
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {workingDays.map((day, idx) => (
            <DayColumn
              key={day.day}
              day={day}
              dayIndex={idx}
              color={getRouteColor(idx)}
              config={config}
              highlighted={highlightedDay === day.day}
              selectedStopName={selectedPOI?.name ?? null}
              onRemoveStop={(seq) => {
                const stop = day.stops.find((s) => s.sequence === seq);
                if (stop) handleRemoveStop(day.day, stop.name, stop.lat, stop.lng);
              }}
              onStopClick={(name, lat, lng) => handleStopClick(day.day, name, lat, lng)}
            />
          ))}
        </div>

        <UnassignedPool pois={unassigned} />

        <DragOverlay>
          {activeDrag && (
            <div
              className={cn(
                "px-2 py-1 rounded text-[10px] font-medium shadow-lg",
                "bg-blue-600 text-white border-2 border-blue-300"
              )}
            >
              {activeDrag.name}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────

function deepCloneDays(days: DayRoute[]): DayRoute[] {
  return days.map((d) => ({
    ...d,
    stops: d.stops.map((s) => ({ ...s })),
  }));
}

function stopsToLocations(stops: { name: string; lat: number; lng: number }[]): Location[] {
  return stops.map((s) => ({ name: s.name, lat: s.lat, lng: s.lng }));
}

function computeUnassigned(days: DayRoute[], allLocations: Location[]): Location[] {
  const assignedKeys = new Set<string>();
  for (const day of days) {
    for (const s of day.stops) {
      if (s.isHome) continue;
      assignedKeys.add(`${s.name}__${s.lat.toFixed(5)}__${s.lng.toFixed(5)}`);
    }
  }
  return allLocations.filter(
    (l) => !assignedKeys.has(`${l.name}__${l.lat.toFixed(5)}__${l.lng.toFixed(5)}`)
  );
}
