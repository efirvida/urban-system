# Tasks: Route Calculation Refactor

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~650-700 (6 new + 3 modified + 1 deleted) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | size:exception OR stacked-to-main (3 slices) |
| Delivery strategy | single-pr-default |
| Chain strategy | size:exception |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: size:exception
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | PR | Notes |
|------|------|----|-------|
| 1 | Provider infrastructure | PR 1 | New code only — types/cache/providers/service (~300 lines added) |
| 2 | clientRouting + frontend wiring | PR 2 | Rewrite `clientRouting.ts`, simplify `page.tsx` matrix phase (~250 lines) |
| 3 | Backend cleanup + verification | PR 3 | Drop `geoapifyMatrix` import, delete file, lint/typecheck (~100 lines) |

> Single-PR alt: keep all 5 phases as one PR with `size:exception` — recommended for a cohesive 4-file routing-stack refactor.

## Phase 1: Foundation — Provider Infrastructure

- [x] 1.1 Create `src/utils/routing/types.ts` — export `RouteProvider`, `RouteLegResult`, `CachedLeg`, `Point` per design.md
- [x] 1.2 Create `src/utils/routing/cache.ts` — port `routeLegKey`/`getCachedLeg`/`setCachedLeg`; value `{distanceKm, durationSeconds, geometry, source, timestamp}`; LRU cap 5000
- [x] 1.3 Create `src/utils/routing/providers/osrm.ts` — `OSRMProvider` (priority 1) calling `router.project-osrm.org` with 5s timeout; `null` on error
- [x] 1.4 Create `src/utils/routing/providers/geoapify.ts` — `GeoapifyProvider` (priority 0); `POST /api/routing` with 2 stops; returns iff `source === "geoapify"`
- [x] 1.5 Create `src/utils/routing/providers/index.ts` — export `defaultProviders: RouteProvider[]` ordered `[Geoapify(0), OSRM(1)]`
- [x] 1.6 Create `src/utils/routing/service.ts` — `RoutingService` with `route(a,b)` chain-of-responsibility and `buildDistanceMatrix(points, onProgress)` returning `Record<"i,j", number>`

## Phase 2: ClientRouting Rewrite

- [ ] 2.1 Rewrite `src/utils/clientRouting.ts` — `buildDistanceMatrices()` delegates to `RoutingService.buildDistanceMatrix()`; drop inline OSRM loop and 5-worker pool
- [ ] 2.2 Refactor `fetchAllRouteGeometries()` to read geometry from enriched routing cache (`cache.ts`) instead of geometry-only cache
- [ ] 2.3 Delete from `clientRouting.ts`: `distCache` Map, `osrmPair()`, `RouteSource` local type, Haversine fallback; preserve public API signatures

## Phase 3: Frontend Wiring

- [ ] 3.1 Replace inline OSRM per-pair loops in `src/app/page.tsx:470-632` with single `RoutingService.buildDistanceMatrix()` call
- [ ] 3.2 Remove `geoapifyTried` state, Geoapify merge block (`page.tsx:666-691`), and `apiPayload.geoapifyTried` field
- [ ] 3.3 Simplify `loadCachedMatrix`/`saveCachedMatrix` (`page.tsx:41-110`) — drop `geoapifyTried` field and sources map; cache stores `{distances, home}` only

## Phase 4: Backend Cleanup

- [ ] 4.1 Remove from `src/app/api/optimize/route.ts`: `geoapifyMatrix` import, `buildGeoapifyMatrix()` call, `geoapifyCache`, `geoapifyTried` body field
- [ ] 4.2 Drop `buildDistanceMatrix()` helper at `route.ts:24-42` and its call site; rewrite inline as a pure `MatrixEntry` mapper when `useStrictMatrix` is true
- [ ] 4.3 Keep `DistanceMatrix`/`MatrixEntry` types and `useStrictMatrix` flag handling intact for optimizer compatibility

## Phase 5: Verification & Cleanup

- [ ] 5.1 Delete `src/utils/geoapifyMatrix.ts` (replaced by `providers/geoapify.ts` + backend proxy)
- [ ] 5.2 Verify `TINY_DISTANCE_KM` in `src/utils/constants.ts` is still referenced by `unreachableFilter.ts:38` — KEEP the constant
- [ ] 5.3 Run `npm run type-check` and `npm run lint` — fix errors, remove unused imports
- [ ] 5.4 Manual E2E: upload small dataset, run optimize; verify matrix has only real distances or `Infinity`; optimizer output bit-identical to pre-refactor
