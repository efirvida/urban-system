# Design: Unify Route Layers

## Technical Approach

Merge the route-layer logic currently split across `useLeafletMarkers` (route stops) and `useLeafletPolylines` (route lines) into a single `useLeafletRoutes` hook. The current split causes rendering-order coupling in `MapView.tsx` (polylines MUST run before markers) and duplicates per-day iteration, color lookup, hiddenDay/highlightDay state propagation, and `selectedPOI` highlight logic. The unified hook owns the full per-day `L.LayerGroup` — glow polyline + route polyline + CircleMarker stops — eliminating ordering dependencies and halving the props surface for route data.

`useLeafletMarkers` shrinks to only home marker + unassigned-location pins (purely spatial data, no route semantics).

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Per-day ownership | One `L.LayerGroup` per day containing all layers (glow, polyline, markers) | Already the pattern in `useLeafletPolylines`. Adding markers to the same group instead of a separate `markersRef` map eliminates ordering concerns and makes `group.clearLayers()` rebuild the full day atomically. |
| Visibility toggle | `setStyle({ opacity })` on individual layers, not `group.remove()` | Preserves existing behavior in both hooks. Allows per-layer opacity differentiation (glow dims to 0.04, route to 0.1, hidden stops to 0.5). Full removal would lose the ability to redisplay without re-creating. |
| Stop marker shape | `L.circleMarker` (radius 14, tooltip), not `L.marker`/`L.divIcon` | `useLeafletMarkers` already uses `circleMarker` because `divIcon` failed with Leaflet z-index. No reason to change — proven pattern. |
| selectedPOI highlight | Separate `useEffect` that iterates markers by `_poiData`, matching by lat/lng/day | Preserves the exact highlight logic from `useLeafletMarkers` (setStyle radius 18 on match, restore to default otherwise). Moves into the unified hook unchanged. |
| Color palette | Duplicate `ROUTE_COLORS` + `getColor` in `useLeafletRoutes` | Both hooks already duplicate the palette. After unification it lives in one place. Consolidating into `constants.ts` adds an import coupling for a 12-element array — not worth the indirection. |

## Data Flow

```
MapView props (routes, routeGeometry, routeSource, hiddenDays, highlightDay, selectedPOI, onPOIClick)
        │
        ▼
useLeafletRoutes(mapRef, options)
        │
        ├─► Per-day loop:
        │     ├─ Build coords (routeGeometry || straight-line fallback)
        │     ├─ Determine dash style (estimated = dashed)
        │     ├─ Get/create L.LayerGroup
        │     ├─ group.clearLayers()
        │     ├─ Add glow polyline  ──► map
        │     ├─ Add route polyline ──► map
        │     └─ Add CircleMarker per stop (tooltip + click + popup) ──► map
        │
        └─► selectedPOI effect: iterate group layers, match _poiData, setStyle(radius 18)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/components/map/useLeafletRoutes.ts` | **Create** | New hook: per-day LayerGroup with glow + polyline + CircleMarker stops. Extracts route-stop rendering from useLeafletMarkers plus all polyline logic from useLeafletPolylines. |
| `src/components/MapView.tsx` | **Modify** | Replace `useLeafletMarkers`+`useLeafletPolylines` calls with single `useLeafletRoutes` call. Keep `useLeafletMarkers` invocation but only for home + location pins. Remove the ordering comment (no longer needed). |
| `src/components/map/useLeafletMarkers.ts` | **Modify** | Remove route-stop rendering block (lines ~111-170) and `selectedPOI` highlight effect (lines ~185-216). Keep home marker + location pins + `fitBounds`. Simplify `MarkerData` interface — drop `hiddenDays`. |
| `src/components/map/useLeafletPolylines.ts` | **Delete** | Fully subsumed by `useLeafletRoutes`. |

## Interfaces / Contracts

```typescript
// New hook signature
export function useLeafletRoutes(
  mapRef: React.RefObject<L.Map | null>,
  options: {
    routes?: DayRoute[];
    routeGeometry?: Map<number, [number, number][]>;
    routeSource?: Map<number, RouteSource>;
    hiddenDays?: Set<number>;
    highlightDay?: number | null;
    onPOIClick?: (lat: number, lng: number, day: number, name: string) => void;
    selectedPOI?: { lat: number; lng: number; day: number; name: string } | null;
  }
): { groupsRef: React.RefObject<Map<number, L.LayerGroup>> }
```

`MarkerData` in `useLeafletMarkers` drops `hiddenDays` — no longer needed when route stops are extracted.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Type check | New hook compiles, MapView props forward correctly | `tsc --noEmit` |
| Lint | No unused imports in modified files | `next lint` |
| Manual | Route display parity — polylines, stop markers, tooltips, click handlers, hidden days, highlight dimming, selectedPOI highlight, estimated dash styles | Test in browser with all wizard phases (config → results → edit) |

No test runner available per `openspec/config.yaml`. Manual parity check against current behavior suffices.

## Migration / Rollout

No migration required. Single-component change with no API or data changes. Behavior is preserved 1:1. Rollback is reverting the commit.

## Open Questions

None. All behavior is extracted from existing code with no semantic changes.
