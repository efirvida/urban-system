# Proposal: Unify Route Layers into `useLeafletRoutes`

## Intent

Map rendering splits per-day visuals across two hooks:
`useLeafletMarkers` (numbered stop circles) and `useLeafletPolylines`
(glow + route line). They share concerns they shouldn't: visibility,
highlight styling, z-order. Each re-derives the day color from
`ROUTE_COLORS`. Consolidate per-day visuals into one hook so the
`L.LayerGroup` is the unit of visibility and styling.

## Scope

### In Scope
- New `src/components/map/useLeafletRoutes.ts` — one `L.LayerGroup`
  per day with glow polyline, route polyline, and stop markers.
- `useLeafletMarkers` keeps only home marker + unassigned pins.
- `useLeafletPolylines` deleted.
- `MapView.tsx` calls `useLeafletRoutes` + reduced `useLeafletMarkers`.
- Update the spec naming the deleted hook.

### Out of Scope
- Any user-visible behavior change (highlight, hiddenDays, dashed
  haversine, selectedPOI, dragHome, popups, tooltips).
- `leafletIcons.ts`, `useLeafletMap.ts`, solvers, RouteEditor.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `routing-source-tracking`: the "Map polyline styling for estimated
  routes" requirement names `useLeafletPolylines` directly. Delta:
  rename reference to `useLeafletRoutes`. Dash/solid behavior
  byte-identical, requirement body unchanged.

## Approach

`useLeafletRoutes` builds a per-day `L.LayerGroup` with glow polyline,
route polyline (with `dashArray` per `routeSource`), and a
`circleMarker` per non-home stop (radius 14/8/6 visible/hidden/
dimmed, with tooltip + click + popup). Visibility and highlight via
`setStyle({ opacity })` on all three layer types. Z-order preserved
by call order in `MapView.tsx`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/components/map/useLeafletRoutes.ts` | New | Replaces per-day logic from both old hooks |
| `src/components/map/useLeafletPolylines.ts` | Removed | Logic → `useLeafletRoutes` |
| `src/components/map/useLeafletMarkers.ts` | Modified | Drops route-stop loop; home + pins only |
| `src/components/MapView.tsx` | Modified | One `useLeafletRoutes` + reduced marker opts |
| `openspec/specs/routing-source-tracking/spec.md` | Delta | Rename hook in one requirement |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Z-order regression (stops under polylines) | Low | Fixed intra-group order; call order in MapView unchanged |
| selectedPOI highlight breaks (`_poiData` walk) | Med | Move that effect to walk `groupsRef` layers filtered by `_poiData` |
| Hidden-day visual mismatch | Low | Hidden = opacity 0 on all three layer types; manual smoke |

## Rollback Plan

Revert single PR. Both old hooks are self-contained; `MapView.tsx`
is the only consumer. `git revert` restores prior state. No data
migration, no schema change.

## Dependencies

None. Pure internal refactor: no new packages, no API or env changes.

## Success Criteria

- [ ] `useLeafletPolylines.ts` removed; `useLeafletRoutes.ts` added.
- [ ] Map output byte-identical (highlight, hidden, haversine, selected,
      dragHome, tooltips, popups).
- [ ] `useLeafletMarkers` < 120 lines (was 228).
- [ ] `next lint` and `tsc --noEmit` clean.
- [ ] Manual smoke: 4-day route, one hidden, one highlighted, one
      selected POI matches pre-refactor.
