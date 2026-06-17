# Design: Route Editor UX Redesign

## Technical Approach

Extract the inline editor from `page.tsx` (lines 838–920) into a `RouteEditor` component that owns edit session state. Use `@dnd-kit/core` + `@dnd-kit/sortable` for drag-and-drop BETWEEN days only. On every add/remove, call `reoptimizeDay()` (new export) — nearest-neighbor from home + 2-opt on the affected day's POI subset — so manual reorder within a day is impossible. Save model: snapshot → mutate → Apply (commit) or Discard (restore snapshot). Undo capped at 20 entries.

## Architecture Decisions

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| Drag-and-drop lib | @dnd-kit vs HTML5 DnD | @dnd-kit | Accessible, React 18–safe, smooth sortable animations. Existing deps are minimal — @dnd-kit adds ~12KB gzipped. |
| State extraction | Keep in page.tsx vs RouteEditor component | RouteEditor component | `page.tsx` is 1006 lines / 42KB. Extracting reduces it by ~150 lines and gives the editor a clear boundary. Matches existing component pattern (ConfigPanel, ResultsPanel). |
| Edit state management | useState vs useReducer vs zustand | useState + EditSession | Consistent with all existing state in page.tsx (20+ useState calls, zero reducers). No new state mgmt lib. |
| Re-optimization | Haversine only vs OSRM API call vs hybrid | Haversine NN + 2-opt from cached matrix | Uses the same `precomputedMatrix` already cached in localStorage. Instant feedback; OSRM 3s timeout per pair is too slow for drag interactions. |
| Constraint gauge | Pure CSS vs SVG | Tailwind progress bar | Simple width + bg color. Red/green/amber class switch at 80%/100% thresholds. No DOM complexity. |

## Data Flow

```
page.tsx                    RouteEditor                  routerOptimizer
─────                       ───────────                  ───────────────
result.days ───prop──→  editSession.snapshot
config ───────prop──→  constraint gauges
matrix ──────prop──→  reoptimizeDay()
                         │
  drag POI to new day ───┤
                         ├─→ reoptimizeDay(sourceDay, home, config, matrix)
                         ├─→ reoptimizeDay(targetDay, home, config, matrix)
                         └─→ setDirty(true), push undo

onPOIClick ──→ setHighlightDay ──→ RouteEditor highlights matching StopItem

Apply ──→ editableDays written back to page.tsx result
             → fetchAllRouteGeometries for changed days
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/components/RouteEditor.tsx` | **Create** | Main orchestrator: editSession, undoStack, dirty, constraint calculations. Renders DayColumns + UnassignedPool + EditorToolbar. |
| `src/components/EditorToolbar.tsx` | **Create** | Apply / Discard / Undo buttons with lucide-react icons. Apply enabled only when dirty. |
| `src/components/DayColumn.tsx` | **Create** | Collapsible day panel with constraint gauge bar (Tailwind `w-[X%]` + conditional bg). Contains SortableContext of StopItems. |
| `src/components/StopItem.tsx` | **Create** | Draggable POI row (useSortable). Shows name, sequence, distance. Remove button (X icon). Click → notify parent to highlight on map. |
| `src/components/UnassignedPool.tsx` | **Create** | Droppable zone for unassigned POIs. POIs can be dragged from here into any DayColumn. |
| `src/utils/routerOptimizer.ts` | **Modify** | Export `reoptimizeDay(pois: Location[], home: Location, config: Config, matrix: Record<string,number>, dayNumber: number): DayRoute`. Returns a fully-built DayRoute with NN + 2-opt ordered stops. |
| `src/types/index.ts` | **Modify** | Add `EditSession` interface. |
| `src/app/page.tsx` | **Modify** | Remove inline editor (lines 838–920). Mount `<RouteEditor>` passing `result.days`, `config`, `locations`, `matrix`, `onApply`, `onDiscard`. Wire `onPOIClick` to `setSelectedPOI` state. |
| `src/components/MapView.tsx` | **Modify** | Add optional `selectedPOI?: { lat: number; lng: number; day: number; name: string } | null` prop; highlight selected POI marker (scale up, ring). |
| `package.json` | **Modify** | Add `@dnd-kit/core` + `@dnd-kit/sortable`. |

## Component Tree

```
Sidebar
└── RouteEditor
    ├── EditorToolbar          [Apply | Discard | Undo]
    ├── DayColumn[0..N]        (DndContext: SortableContext)
    │   ├── constraint gauge   (Tailwind progress bar)
    │   └── StopItem[0..N]     (useSortable — draggable between days)
    │       └── Remove button
    └── UnassignedPool         (Droppable: useDroppable)
        └── POI chips          (useDraggable)
```

## Key Type Definitions

```typescript
// src/types/index.ts additions

interface EditMutation {
  type: "move" | "remove" | "add";
  poiName: string;
  fromDay: number;
  toDay: number;
  priorDays: DayRoute[];  // snapshot before this mutation
}

interface EditSession {
  snapshot: DayRoute[];       // result.days at edit-mode entry
  dirty: boolean;             // true if any mutation since entry
  undoStack: EditMutation[];  // max 20
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `reoptimizeDay()` correctness | Given POI subset + matrix → verify output is improved (NN + 2-opt loop). Pure function, no API. |
| Integration | Drag POI between days re-optimizes both | Mount RouteEditor with mock data, simulate dnd-kit events, assert both days reordered. |
| Build | No regressions | `tsc --noEmit` + `next build` must pass (per openspec config). |

## Open Questions

- [ ] Should `reoptimizeDay` share the GA post-optimizer for large days (>15 POIs), or is NN+2-opt sufficient for edit-mode interactivity? (Recommend: NN+2-opt only; GA is async and too slow for drag.)
- [ ] On Apply, should we refetch route geometries for ALL days or only changed ones? (Recommend: changed only, tracked via dirty day set.)
