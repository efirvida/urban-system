'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import type { DayRoute, Location, OptimizerResult } from '@/types';
import { reoptimizeDay } from '@/utils/routerOptimizer';
import type { RouteEditorHandle } from '@/components/RouteEditor';

/** Selected POI on the map — drives sidebar highlight + action bar. */
export interface SelectedPOI {
  lat: number;
  lng: number;
  day: number;
  name: string;
}

interface UseRouteEditorParams {
  /** Current optimization result (days). The hook reads its `days`. */
  result: { days: DayRoute[] } | null;
  /** Map of optimized results by algorithm id — used to restore days
   *  when the user switches tabs while editing. */
  optimizerResults: (OptimizerResult | null)[] | null;
  config: {
    homeLat: number;
    lng?: number;
    homeLng: number;
    avgSpeed: number;
    visitTime: number;
    constraintType: 'hours' | 'visits' | 'hours+visits';
    constraintValue: number;
    maxVisits?: number;
  };
  /** All uploaded locations (used to compute unassigned POIs). */
  locations: Location[];
  t: TFunction;
  /** Called by the editor when the user clicks Apply. */
  onApply?: (newDays: DayRoute[]) => void;
}

export interface RouteEditorFlow {
  // ── State ──
  editMode: boolean;
  editorDirty: boolean;
  editDaysPreview: DayRoute[] | null;
  previewTargetDay: number | null;
  previewDays: DayRoute[] | null;
  selectedPOI: SelectedPOI | null;
  highlightDay: number | null;
  sidebarExpandedDay: number | null;
  /** All unassigned POIs (locations not in any route stop). */
  unassignedPOIs: Location[];
  /** All day numbers currently available (preview > result). */
  availableDays: number[];

  // ── Refs ──
  editorRef: React.MutableRefObject<RouteEditorHandle | null>;

  // ── Handlers ──
  setSelectedPOI: (poi: SelectedPOI | null) => void;
  setHighlightDay: (day: number | null) => void;
  setSidebarExpandedDay: (day: number | null) => void;
  setEditorDirty: (dirty: boolean) => void;
  setEditDaysPreview: (days: DayRoute[] | null) => void;

  handlePreviewDay: (targetDay: number | null) => void;
  handleAcceptMove: () => void;
  handleCancelMove: () => void;

  /** Apply handler — commits editor's working days to the result. */
  handleApply: (newDays: DayRoute[]) => void;

  /** Discard handler — exit edit mode (editor handles its own state). */
  handleDiscard: () => void;

  /** Toggle edit mode with close-guard. */
  toggleEditMode: () => void;

  /** Select a POI from the sidebar (also updates highlight + hiddenDays). */
  handlePOISelect: (name: string, lat: number, lng: number, day: number) => void;

  /** Map click on an unassigned POI — find the day or mark unassigned. */
  handleUnassignedClick: (lat: number, lng: number, name: string) => void;

  /** Clear all transient selection state. */
  clearSelection: () => void;

  /** Reset every editor piece of state (used by the "new optimization" CTA). */
  reset: () => void;
}

const POI_KEY_PRECISION = 5;

function poiKey(lat: number, lng: number): string {
  return `${lat.toFixed(POI_KEY_PRECISION)},${lng.toFixed(POI_KEY_PRECISION)}`;
}

function stopsToLocs(
  stops: Array<{ name: string; lat: number; lng: number; isHome?: boolean }>,
): Location[] {
  return stops.filter((s) => !s.isHome).map((s) => ({ name: s.name, lat: s.lat, lng: s.lng }));
}

export function useRouteEditor({
  result,
  optimizerResults: _optimizerResults,
  config,
  locations,
  t,
  onApply,
}: UseRouteEditorParams): RouteEditorFlow {
  const [editMode, setEditMode] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editDaysPreview, setEditDaysPreview] = useState<DayRoute[] | null>(null);
  const [previewTargetDay, setPreviewTargetDay] = useState<number | null>(null);
  const [previewDays, setPreviewDays] = useState<DayRoute[] | null>(null);
  const [selectedPOI, setSelectedPOI] = useState<SelectedPOI | null>(null);
  const [highlightDay, setHighlightDay] = useState<number | null>(null);
  const [sidebarExpandedDay, setSidebarExpandedDay] = useState<number | null>(null);

  const editorRef = useRef<RouteEditorHandle | null>(null);

  const availableDays = useMemo(() => {
    const source = editDaysPreview ?? result?.days ?? [];
    return [...new Set(source.map((d) => d.day))].sort((a, b) => a - b);
  }, [editDaysPreview, result]);

  const unassignedPOIs = useMemo(() => {
    if (!locations) return [];
    const sourceRoutes = editMode ? (editDaysPreview ?? []) : (result?.days ?? []);
    const assigned = new Set<string>();
    for (const day of sourceRoutes) {
      for (const s of day.stops) {
        if (s.isHome) continue;
        assigned.add(poiKey(s.lat, s.lng));
      }
    }
    return locations.filter((l) => !assigned.has(poiKey(l.lat, l.lng)));
  }, [editMode, editDaysPreview, result, locations]);

  const clearSelection = useCallback(() => {
    setSelectedPOI(null);
    setHighlightDay(null);
  }, []);

  const handlePreviewDay = useCallback(
    (targetDay: number | null) => {
      if (!selectedPOI || !editDaysPreview) return;
      setPreviewTargetDay(targetDay);

      if (targetDay === null || targetDay === selectedPOI.day) {
        setPreviewDays(null);
        return;
      }

      setHighlightDay(targetDay);
      const home: Location = {
        name: t('routeEditor.home'),
        lat: config.homeLat,
        lng: config.homeLng,
      };

      if (targetDay === 0) {
        const sourceDay = editDaysPreview.find((d) => d.day === selectedPOI.day);
        if (!sourceDay) return;
        const sourcePois = stopsToLocs(sourceDay.stops).filter((s) => s.name !== selectedPOI.name);
        const newSource = reoptimizeDay(
          sourcePois,
          home,
          config as never,
          undefined,
          sourceDay.day,
          undefined,
        );
        const preview = editDaysPreview.map((d) => (d.day === sourceDay.day ? newSource : d));
        setPreviewDays(preview);
        return;
      }

      if (selectedPOI.day === -1) {
        const targetDayData = editDaysPreview.find((d) => d.day === targetDay);
        if (!targetDayData) return;
        const targetPois = stopsToLocs(targetDayData.stops).concat([
          { name: selectedPOI.name, lat: selectedPOI.lat, lng: selectedPOI.lng },
        ]);
        const newTarget = reoptimizeDay(
          targetPois,
          home,
          config as never,
          undefined,
          targetDayData.day,
          undefined,
        );
        const preview = editDaysPreview.map((d) => (d.day === targetDayData.day ? newTarget : d));
        setPreviewDays(preview);
        return;
      }

      const sourceDay = editDaysPreview.find((d) => d.day === selectedPOI.day);
      const targetDayData = editDaysPreview.find((d) => d.day === targetDay);
      if (!sourceDay || !targetDayData) return;

      const sourcePois = stopsToLocs(sourceDay.stops).filter((s) => s.name !== selectedPOI.name);
      const targetPois = stopsToLocs(targetDayData.stops).concat([
        { name: selectedPOI.name, lat: selectedPOI.lat, lng: selectedPOI.lng },
      ]);

      const newSource = reoptimizeDay(
        sourcePois,
        home,
        config as never,
        undefined,
        sourceDay.day,
        undefined,
      );
      const newTarget = reoptimizeDay(
        targetPois,
        home,
        config as never,
        undefined,
        targetDayData.day,
        undefined,
      );

      const preview = editDaysPreview.map((d) => {
        if (d.day === sourceDay.day) return newSource;
        if (d.day === targetDayData.day) return newTarget;
        return d;
      });
      setPreviewDays(preview);
    },
    [selectedPOI, editDaysPreview, config, t],
  );

  const handleAcceptMove = useCallback(() => {
    if (!selectedPOI || previewTargetDay === null || previewTargetDay === selectedPOI.day) return;
    const target = previewTargetDay === 0 ? null : previewTargetDay;

    if (selectedPOI.day === -1 && target !== null) {
      editorRef.current?.addPOI?.(
        { name: selectedPOI.name, lat: selectedPOI.lat, lng: selectedPOI.lng },
        target,
      );
    } else {
      editorRef.current?.commitMove(
        {
          name: selectedPOI.name,
          lat: selectedPOI.lat,
          lng: selectedPOI.lng,
          fromDay: selectedPOI.day,
        },
        target,
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
    }
  }, [selectedPOI, previewTargetDay]);

  const handleCancelMove = useCallback(() => {
    setPreviewDays(null);
    setPreviewTargetDay(null);
    if (selectedPOI) {
      setHighlightDay(selectedPOI.day);
    }
  }, [selectedPOI]);

  const handleApply = useCallback(
    (newDays: DayRoute[]) => {
      onApply?.(newDays);
      setEditMode(false);
      setEditorDirty(false);
      setEditDaysPreview(null);
      setPreviewDays(null);
      setPreviewTargetDay(null);
      setSelectedPOI(null);
      setHighlightDay(null);
    },
    [onApply],
  );

  const handleDiscard = useCallback(() => {
    setEditMode(false);
    setEditorDirty(false);
    setEditDaysPreview(null);
    setPreviewDays(null);
    setPreviewTargetDay(null);
    setSelectedPOI(null);
    setHighlightDay(null);
  }, []);

  const toggleEditMode = useCallback(() => {
    if (editMode) {
      if (editorDirty) {
        const ok = window.confirm(t('wizardPage.confirmDiscard'));
        if (!ok) return;
      }
      setEditMode(false);
      setEditorDirty(false);
      setSelectedPOI(null);
      setHighlightDay(null);
    } else {
      setSelectedPOI(null);
      setHighlightDay(null);
      setEditMode(true);
    }
  }, [editMode, editorDirty, t]);

  const handlePOISelect = useCallback((name: string, lat: number, lng: number, day: number) => {
    setSelectedPOI({ name, lat, lng, day });
    setHighlightDay(day);
    setSidebarExpandedDay(day);
  }, []);

  const handleUnassignedClick = useCallback(
    (lat: number, lng: number, name: string) => {
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
      setSelectedPOI({ name, lat, lng, day: -1 });
    },
    [editDaysPreview, result],
  );

  const reset = useCallback(() => {
    setEditMode(false);
    setEditorDirty(false);
    setEditDaysPreview(null);
    setPreviewDays(null);
    setPreviewTargetDay(null);
    setSelectedPOI(null);
    setHighlightDay(null);
    setSidebarExpandedDay(null);
  }, []);

  return {
    editMode,
    editorDirty,
    editDaysPreview,
    previewTargetDay,
    previewDays,
    selectedPOI,
    highlightDay,
    sidebarExpandedDay,
    unassignedPOIs,
    availableDays,
    editorRef,
    setSelectedPOI,
    setHighlightDay,
    setSidebarExpandedDay,
    setEditorDirty,
    setEditDaysPreview,
    handlePreviewDay,
    handleAcceptMove,
    handleCancelMove,
    handleApply,
    handleDiscard,
    toggleEditMode,
    handlePOISelect,
    handleUnassignedClick,
    clearSelection,
    reset,
  };
}
