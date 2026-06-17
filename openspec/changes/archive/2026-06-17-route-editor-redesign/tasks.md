# Tasks: Route Editor UX Redesign

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~650 (5 new components + 4 modifications) |
| 400-line budget risk | Low (review budget 800 — D2) |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | auto-forecast |
| Chain strategy | size-exception (within 800-line budget) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

## Phase 1: Foundation

- [x] 1.1 Install `@dnd-kit/core` + `@dnd-kit/utilities`; add to `package.json` and run `npm install`. (Note: skipped @dnd-kit/sortable — see deviation log; spec forbids within-day reorder so sortable is not needed.)
- [x] 1.2 In `src/types/index.ts` add `EditMutation` and `EditSession` interfaces per design §"Key Type Definitions".
- [x] 1.3 In `src/utils/routerOptimizer.ts` export `reoptimizeDay(locations, home, config, matrix, dayNumber): DayRoute` (NN from home + 2-opt loop, Haversine-based).
- [x] 1.4 Unit test `reoptimizeDay()` in `src/utils/__tests__/routerOptimizer.test.ts` (asserts output distance ≤ input order). **Skipped**: no test runner detected; `strict_tdd: false` per delivery info. *(Reconciled at archive time per orchestrator instruction: task is intentionally out-of-scope, not stale — see `apply-progress` #1330 and `archive-report`.)*

## Phase 2: RouteEditor Component Shell

- [x] 2.1 Create `src/components/RouteEditor.tsx` (`'use client'`) accepting `result`, `config`, `matrix`, `locations`, `onApply`, `onDiscard`, `onPOISelect`.
- [x] 2.2 Implement state: `snapshot`, `editableDays`, `unassigned`, `undoStack` (cap 20), `dirty`, `highlightedDay`.
- [x] 2.3 Create `src/components/DayColumn.tsx` — collapsible panel with constraint gauge and `useDroppable` body. (Note: not `<SortableContext>` — see deviation log.)
- [x] 2.4 Create `src/components/StopItem.tsx` with `useDraggable`; renders name, sequence, distance; `X` button removes; click calls `onPOISelect`. (Note: `useDraggable` not `useSortable` — see deviation log.)
- [x] 2.5 Create `src/components/UnassignedPool.tsx` with `useDroppable`; lists unassigned POIs as draggable chips.

## Phase 3: Drag-and-Drop + Auto-Reoptimization

- [x] 3.1 Wrap `RouteEditor` in `<DndContext onDragEnd={handleDragEnd}>`; handle cross-day and pool→day moves.
- [x] 3.2 In `handleDragEnd`: call `reoptimizeDay()` on both source + target days, push `EditMutation`, set `dirty=true`. Ignore within-day drop indices.
- [x] 3.3 In `src/app/page.tsx` remove inline editor (lines 838–920); mount `<RouteEditor>` only when `editMode === true`.

## Phase 4: Save Model + Undo

- [x] 4.1 Create `src/components/EditorToolbar.tsx` with `Apply`, `Discard`, `Undo2`, `Redo2` buttons (lucide icons); disable `Apply`/`Discard` when `!dirty`, `Undo`/`Redo` when stack empty.
- [x] 4.2 `handleApply`: write `editableDays` → `result.days`, recompute polylines for changed days, clear `undoStack`. (Geometries are refetched via `refetchGeometries(newDays)` after Apply.)
- [x] 4.3 `handleDiscard`: restore `editableDays` + `unassigned` from `snapshot`. `handleUndo`: pop mutation, restore `priorDays`. `handleRedo` mirrors undo.
- [x] 4.4 Close-guard: if user clicks "Terminar edición" while dirty, confirm dialog. Wired in `toggleEditMode` in page.tsx.

## Phase 5: Per-Day Constraint Gauges

- [x] 5.1 In `DayColumn` compute gauge ratio from `config.constraintType` / `config.constraintValue`; `hours+visits` uses `max(hoursRatio, visitsRatio)` — the more restrictive constraint is the one binding the day. (Spec text said "min" but the example in the spec scenario for `hoursRatio=0.9, visitsRatio=0.6` gives binding=0.9 which is `max` — followed the example.)
- [x] 5.2 Render Tailwind bar: `bg-emerald-500` < 80%, `bg-amber-500` 80–99%, `bg-red-500` ≥ 100%; width = `min(ratio, 1) * 100%`. Plus a secondary thin bar showing the looser constraint when in hours+visits mode.

## Phase 6: Map Integration

- [x] 6.1 In `MapView.tsx` add `selectedPOI?: { lat, lng, day, name } | null` prop; render scale-up + ring on matching marker. (Note: I chose the `{ lat, lng, day, name }` shape over `selectedPOIId` because it removes the need for the caller to track marker IDs.)
- [x] 6.2 In `page.tsx` add `selectedPOI` state; wire `onPOIClick` → `setSelectedPOI`; pass to `RouteEditor` and `MapView`.
- [x] 6.3 In `RouteEditor`, when `selectedPOI` changes, `highlightedDay` is derived from it and the corresponding `DayColumn` gets the highlight class.

## Phase 7: Icon Migration + Polish

- [x] 7.1 Replace every editor emoji with `lucide-react`: `Pencil`, `Save`, `X`, `Undo2`, `Redo2`, `GripVertical`, `MapPin`, `Eye`, `EyeOff`, `House`, `BarChart3`, `ChevronDown`, `Clock`, `Map`, `Car`, `Ruler`.
- [x] 7.2 `tsc --noEmit` and `next build` both pass clean.
- [x] 7.3 Smoke test: editor opens, DayColumns render with constraint gauges, StopItems are draggable (GripVertical handle), UnassignedPool is droppable, cross-day drag reoptimizes both days via Haversine NN+2-opt, Apply/Discard/Undo/Redo all wired, map click highlights the matching marker.
