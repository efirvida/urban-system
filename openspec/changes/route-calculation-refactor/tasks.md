# Tasks: Route Calculation Refactor

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~520 (rewrite `clientRouting.ts` ~250, cleanup `api/optimize/route.ts` ~-70, simplify `page.tsx` ~-130, delete `geoapifyMatrix.ts` ~210, touch `constants.ts`) |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | single PR with `size:exception` |
| Delivery strategy | single-pr-default |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

## Phase 1: Foundation — Rewrite `src/utils/clientRouting.ts`

- [ ] 1.1 Extend per-leg cache: `routeLegKey` stores `{coords, distance, source}` JSON; add `getCachedLegEntry` / `setCachedLegEntry`
- [ ] 1.2 Cache sentinel for failed legs: persist `{distance: Infinity, source: "unreachable"}` so refetch is skipped
- [ ] 1.3 Add `fetchLegDistance(lat1, lng1, lat2, lng2): Promise<number>` — cache check → `POST /api/routing` with 2 stops → return `response.distance` or `Infinity` when source is `"haversine"` / empty
- [ ] 1.4 Rewrite `buildDistanceMatrices` to call `fetchLegDistance` per pair (5 parallel); delete `osrmPair`, `distCache`, Haversine fill
- [ ] 1.5 Update `fetchAllRouteGeometries` to read source from new cache shape; stitch legs from the updated cache without re-fetching

## Phase 2: Frontend Wiring — `src/app/page.tsx`

- [ ] 2.1 Simplify `loadCachedMatrix` / `saveCachedMatrix` signatures to drop the `geoapifyTried` field
- [ ] 2.2 Delete the inline OSRM per-pair home loop (lines ~509-559) and the full-matrix OSRM loop (lines ~570-628)
- [ ] 2.3 Replace both loops with a single `await buildDistanceMatrices(home, locations, onProgress)` call
- [ ] 2.4 Drop `geoapifyTried` from `apiPayload`; delete the `_matrixCache` / `_geoapifyTried` merge block (lines ~666-691)
- [ ] 2.5 Remove now-unused local helpers (`isSamePoint`, `geoapifyTried` var, `t0` / `tOsrm` timers if unused)

## Phase 3: Backend Cleanup — `src/app/api/optimize/route.ts`

- [ ] 3.1 Remove `import { buildGeoapifyMatrix } from "@/utils/geoapifyMatrix"`
- [ ] 3.2 Delete the `buildDistanceMatrix` helper function and its JSDoc
- [ ] 3.3 Remove `geoapifyTried` / `geoapifyCache` from body destructure; drop the override loop (lines ~99-130) and the `geoapifyKey` branch
- [ ] 3.4 Simplify `useStrictMatrix` branch: build `DistanceMatrix` from `frontendMatrix` directly (finite → `"real"`, else `"unreachable"`)
- [ ] 3.5 Strip Geoapify references from `_meta` and final log lines; keep only real / unreachable counts

## Phase 4: Cleanup & Verification

- [ ] 4.1 Delete `src/utils/geoapifyMatrix.ts`
- [ ] 4.2 Update `src/utils/constants.ts` header comment to drop the reference to the deleted file
- [ ] 4.3 Verify `TINY_DISTANCE_KM` is still used by `src/utils/unreachableFilter.ts:38` — keep it; remove the export only if the import disappears
- [ ] 4.4 Run `npm run type-check && npm run lint` — both must pass clean
- [ ] 4.5 Manual smoke test: upload the sample spreadsheet, confirm UI total distance === optimizer total distance
