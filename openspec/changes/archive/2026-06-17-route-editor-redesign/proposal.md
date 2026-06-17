# Proposal: Route Editor UX Redesign

## Intent
Replace the inline ~70-line route editor in `page.tsx` (results phase, add/remove-only) with a full-featured `RouteEditor` component: drag-and-drop between days, drag from an unassigned pool, map click integration, explicit Apply / Discard / Undo save model, and per-day constraint gauges.

**Hard rule (non-negotiable):** no manual reordering of POIs within a day. Adding or removing a POI from a day MUST trigger automatic reoptimization of that day's remaining POIs. The product is a route optimizer, not a manual editor.

## Scope
### In Scope
- Extract editor state out of `page.tsx` into `src/components/RouteEditor.tsx`
- New subcomponents: `EditorToolbar`, `DayColumn`, `StopItem`, `UnassignedPool`
- `reoptimizeDay()` exported from `routerOptimizer.ts` for day-level re-opt
- `EditSession` type in `types/index.ts` (snapshot + dirty flag + undo stack)
- MapView edit-mode interactions (wire `onPOIClick` → sidebar select + day highlight)
- Replace all editor emojis with `lucide-react` icons (already in deps, currently unused)
- Keep the existing sidebar + map split layout and `ROUTE_COLORS` palette

### Out of Scope
- New backend / API changes (reuses existing `/api/routing` + matrix cache)
- Editing `Config` from the editor (re-run optimize flow stays as-is)
- Real-time collaborative editing
- Map-based POI creation (POIs come from .xlsx upload only)
- Touch / mobile-first interactions (desktop only this round)

## Capabilities
### New Capabilities
- `route-editing`: extract the WIP inline editor into a formal capability spec covering drag-and-drop re-assignment, save/discard/undo model, map integration, constraint gauges, and auto-reoptimization of a day's POIs on add/remove.

### Modified Capabilities
None.

## Approach
1. Extract `RouteEditor` shell from `page.tsx` — owns `editableDays`, `unassignedPOIs`, `editSession`, `dirty`, `undoStack`. Mount only after the user toggles edit mode (client-only, no SSR).
2. Drag-drop with `@dnd-kit/core` + `@dnd-kit/sortable` (lightweight, accessible, no React 18 strict-mode issues).
3. `reoptimizeDay(day, home, config, matrix)` in `routerOptimizer.ts` — nearest-neighbor + 2-opt over the day's POI subset using the cached matrix; Haversine fallback for missing pairs (matches `routing.ts` policy).
4. Per-day constraint gauge: progress bar colored green → yellow → red at 80% / 100% of `config.constraintValue`. In `hours+visits` mode, use `min(hoursRatio, visitsRatio)` as the binding constraint.
5. Save model: snapshot `result.days` at edit-mode entry. `Apply` commits `editableDays` back to `result`; `Discard` restores the snapshot; `Undo` pops the last mutation. Cap undo stack at 20.
6. Map integration: `onPOIClick(poiId)` selects the POI in the sidebar and highlights its day; on Apply, recompute polylines for changed days only.

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| `src/app/page.tsx` | Modified | Remove inline editor; mount `<RouteEditor />`; pass `result` + `config` + `matrix` |
| `src/components/RouteEditor.tsx` | **New** | Main editor, owns edit session state |
| `src/components/EditorToolbar.tsx` | **New** | Apply / Discard / Undo / map-mode toggle |
| `src/components/DayColumn.tsx` | **New** | Collapsible day column with constraint gauge |
| `src/components/StopItem.tsx` | **New** | Draggable stop row |
| `src/components/UnassignedPool.tsx` | **New** | Draggable POI pool |
| `src/components/MapView.tsx` | Modified | Wire `onPOIClick` → editor select; edit-mode polyline refresh |
| `src/utils/routerOptimizer.ts` | Modified | Export `reoptimizeDay()` |
| `src/types/index.ts` | Modified | Add `EditSession` interface |
| `package.json` | Modified | Add `@dnd-kit/core` + `@dnd-kit/sortable` |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `@dnd-kit` SSR hydration mismatch | Med | Mount editor only after edit-mode toggle (client-only) |
| Matrix miss on removed POIs | Med | Haversine fallback (matches `routing.ts` policy) |
| Undo stack grows unbounded | Low | Cap at 20 mutations; reset on Apply / Discard |
| Constraint gauge mis-color in `hours+visits` | Low | `min(hoursRatio, visitsRatio)` as binding constraint |
| WIP regression from `page.tsx` extraction | Med | Verify with `next build` + `tsc --noEmit` |

## Rollback Plan
Revert the single PR that introduces `RouteEditor` and the `page.tsx` extraction. `reoptimizeDay` is additive to `routerOptimizer.ts` — safe to leave in. Drag-drop deps removable via `npm uninstall @dnd-kit/core @dnd-kit/sortable`. No data migrations.

## Dependencies
- New: `@dnd-kit/core`, `@dnd-kit/sortable`
- Existing: `lucide-react` (installed, unused), `ROUTE_COLORS` palette in `src/lib/utils.ts`

## Success Criteria
- [ ] `RouteEditor` renders for any non-empty `result.days`
- [ ] Dragging a POI between days re-optimizes both days; manual reorder is impossible
- [ ] `Apply` commits, `Discard` reverts to entry snapshot, `Undo` reverts last mutation
- [ ] Constraint gauge shows green → yellow → red progression matching `config.constraintType`
- [ ] Map POI click → select in sidebar + highlight day
- [ ] All editor emojis replaced with `lucide-react` icons
- [ ] `tsc --noEmit` + `next build` pass with no new errors
