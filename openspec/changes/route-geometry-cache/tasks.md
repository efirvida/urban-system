# Tasks: Route Geometry Cache

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~120 (1 new file ~100 LoC + ~20 LoC edit in `clientRouting.ts` + 1 dep line) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr-default |
| Chain strategy | single-pr |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: single-pr
400-line budget risk: Low

### Suggested Work Units

Not needed — single PR covers all work.

## Phase 1: Dependency + Interface

- [x] 1.1 Install `@mapbox/polyline` and save to `package.json` dependencies (`npm install @mapbox/polyline`)
- [x] 1.2 Create `src/utils/routing/geometryCache.ts` exporting `RouteGeometryCache` interface (`get`, `set`, `clear`)
- [x] 1.3 Implement `LocalStorageGeometryCache` class in the same file: `ROUTE_GEOMETRY_` prefix, 200-entry cap, timestamp-based LRU (drop oldest 20% on overflow)
- [x] 1.4 Implement `routeGeometryKey(stops)` helper: sort + dedupe + `toFixed(5)` coords, djb2 hash → base 36, `geo_` prefix (mirror `locationsHash` in `page.tsx`)
- [x] 1.5 Use `@mapbox/polyline` for encode/decode in `set`/`get` at precision 5; persist `{ encoded, source, timestamp }`

## Phase 2: Integration

- [x] 2.1 In `src/utils/clientRouting.ts`, import `geometryCache` and `routeGeometryKey`; in `fetchAllRouteGeometries()`, before each `POST /api/routing`, call `geometryCache.get(key)`
- [x] 2.2 On cache hit: decode polyline, set `routeCoords` and `apiSource` from the cached `source`; skip the fetch
- [x] 2.3 On cache miss: keep the existing fetch; after a successful response, call `geometryCache.set(key, routeCoords, apiSource)` before storing in the map
- [x] 2.4 Export the singleton `geometryCache` instance from the module so consumers can `clear()` it for debugging

## Phase 3: Quality

- [x] 3.1 Run `npx tsc --noEmit` — must pass with zero errors (TypeScript strict)
- [x] 3.2 Run `npx next lint` — must pass with zero warnings/errors
- [x] 3.3 Run `npm run build` — verify the production build succeeds (catches any RSC/client boundary issues)
- [ ] 3.4 Manual verify: load results once (8 `/api/routing` calls expected), reload same results (0 calls expected, polyline renders identically on the map)
- [ ] 3.5 Manual verify: seed > 200 cache entries in DevTools, trigger one more `set`, confirm oldest 20% are dropped
