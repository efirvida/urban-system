# Proposal: Route Geometry Cache

## Intent

`fetchAllRouteGeometries()` re-fetches fresh polyline geometry from `/api/routing` on every results view. With 47 locations across 8 days, that's 8 unnecessary API calls per view. Add a swappable caching abstraction (localStorage + encoded polyline compression) so future implementations (IndexedDB, server-side) can replace it without changing consumer code.

## Scope

### In Scope
- New `RouteGeometryCache` interface in `src/utils/routing/geometryCache.ts`
- `LocalStorageGeometryCache` implementation using `@mapbox/polyline` (precision 5, ~1cm accuracy)
- Wire `fetchAllRouteGeometries()` to use cache-first, API-fallback
- Timestamp-based LRU eviction, 200-entry cap (~40KB)
- Add `@mapbox/polyline` to `dependencies` in `package.json`

### Out of Scope
- IndexedDB or server-side cache implementations
- Changes to the per-leg distance/source cache (`cache.ts`)
- Changes to map rendering or polyline styling

## Capabilities

### New Capabilities
None

### Modified Capabilities
None

> Pure infrastructure. No spec-level behavior changes — per-day geometry is byte-identical to a fresh fetch. The only observable difference is fewer `/api/routing` calls on repeated views.

## Approach

1. Install `@mapbox/polyline` (well-maintained, ~0 deps, MIT, standard for encoded polylines).
2. Create `src/utils/routing/geometryCache.ts` exporting:
   - `RouteGeometryCache` interface (`get(key)`, `set(key, geometry, source)`, `clear()`)
   - `LocalStorageGeometryCache` class with `ROUTE_GEOMETRY_` prefix, 200-entry cap
   - `routeGeometryKey(stops)` helper (sorted, deduped, precision-5 coord hash)
3. In `clientRouting.ts`, check cache before each `/api/routing` POST. On hit return immediately; on miss fetch, store, return.
4. Eviction: when key count exceeds 200, drop oldest by `timestamp`. Sweep is O(n) but only runs at threshold crossings.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/utils/routing/geometryCache.ts` | New | Interface + LocalStorage impl |
| `src/utils/clientRouting.ts` | Modified | `fetchAllRouteGeometries()` consults cache first |
| `package.json` | Modified | Add `@mapbox/polyline` dep |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Polyline precision loss | Low | Precision 5 ≈ 1cm accuracy; exceeds map zoom ~18 needs |
| localStorage quota | Low | 200 entries × ~200B ≈ 40KB; well under 5MB origin limit |
| Stale geometry on road changes | Low | Geometry is short-lived; users re-optimize before re-viewing |
| Cache key collision | Low | Sorted stop list + 5-decimal precision = effectively unique |

## Rollback Plan

1. Remove cache lookup from `fetchAllRouteGeometries()` (revert to direct API fetch).
2. Delete `src/utils/routing/geometryCache.ts`.
3. `npm uninstall @mapbox/polyline`.
4. Orphaned `ROUTE_GEOMETRY_*` localStorage entries become harmless — no read sites.

## Dependencies

- `@mapbox/polyline` (new, ~0 deps, MIT)

## Success Criteria

- [ ] Second view of the same results triggers 0 `/api/routing` calls
- [ ] Cached geometry renders byte-identical to fresh API geometry on the map
- [ ] `tsc --noEmit` and `next lint` pass
- [ ] localStorage usage stays under 50KB after an 8-day, 50-stop optimization
