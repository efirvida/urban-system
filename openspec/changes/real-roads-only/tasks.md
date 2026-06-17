# Tasks: Real Roads Only

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~620 total (PR1≈130, PR2≈30, PR3≈90, PR4≈60, PR5≈60, PR6≈250) |
| 400-line budget risk | Low per-PR (max ≈250 in PR 6) |
| Chained PRs recommended | No (each PR already focused) |
| Suggested split | 6 stacked-to-main PRs, in order |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Work Units

| # | Goal | PR | Base | Depends on |
|---|------|----|------|------------|
| 1 | Pre-filter unreachable POIs; expose in response | PR 1 | main | — |
| 2 | `matGet` returns `Infinity` (not `0`) | PR 2 | main | — |
| 3 | UI badge + "Try again" CTA | PR 3 | main | PR 1 |
| 4 | `reoptimizeDay` consumes matrix | PR 4 | main | PR 1 |
| 5 | Map dashed lines for estimated legs | PR 5 | main | — |
| 6 | Discriminated `MatrixEntry` (gated flag) | PR 6 | main | PR 1, 2, 4, 5 |

---

## PR 1 — Pre-filter unreachable POIs

**Goal:** Reject POIs with no real road to home before the optimizer; expose them in the response.

- [x] **T1.1** Create `src/utils/constants.ts` exporting `REAL_VS_ESTIMATED_KM = 0.1` and `TINY_DISTANCE_KM = 0.05`. _Files:_ new file. _Verify:_ `tsc --noEmit` clean.
- [x] **T1.2** Create `src/utils/unreachableFilter.ts` exporting `filterUnreachable(locations, home, matrix, haversineRef): { reachable: Location[]; unreachable: UnreachablePoi[] }`. _Files:_ new file. _Verify:_ unit smoke: 100% real matrix → empty `unreachable`; pure-Haversine matrix → all in `unreachable`.
- [x] **T1.3** Wire `filterUnreachable` into `src/app/api/optimize/route.ts` between Step 2 (Geoapify) and Step 3 (optimize); pass `reachable` to `optimizeRoutes`; attach `unreachable: UnreachablePoi[]` to response payload. _Files:_ `src/app/api/optimize/route.ts`. _Verify:_ HTTP test with 1 isolated POI → `unreachable.length === 1`, `days` excludes it.
- [x] **T1.4** Add `unreachable?: UnreachablePoi[]` (and the new `UnreachablePoi` interface) to `OptimizeResponse` in `src/types/index.ts`; also surface `unreachableCount` in `_meta`. _Files:_ `src/types/index.ts`. _Verify:_ `tsc --noEmit` clean.
- [x] **T1.5** Replace magic literals `0.1` / `0.01` in `src/app/api/optimize/route.ts` (lines 87, 113) with `REAL_VS_ESTIMATED_KM`. _Files:_ same. _Verify:_ grep returns no matches for the old literals.

**Deps:** none. **Rollback:** revert; optimizer sees all POIs again (no data loss).
**Acceptance (spec §`unreachable-poi-handling`):** "All reachable" → `unreachable: []`, `days` covers 5. "One unreachable" → `unreachable` lists X, `days` covers 4. "All unreachable" → `days: []`, HTTP 200.

---

## PR 2 — Fix matGet:0 bug

**Goal:** Missing matrix keys propagate `Infinity` instead of poisoning candidates with `0`.

- [x] **T2.1** Change `matGet` default in `src/utils/routerOptimizer.ts:15-18` from `return 0` to `return Infinity`; keep the `console.warn`. _Files:_ `src/utils/routerOptimizer.ts`. _Verify:_ trace shows `Infinity` for missing key; single warning logged.
- [x] **T2.2** Remove Haversine fallback in `pd()` of `src/utils/geneticOptimizer.ts:16-34`; when `pre` is provided and `pre[k]` is undefined, return `Infinity`. _Files:_ `src/utils/geneticOptimizer.ts`. _Verify:_ GA candidate with missing pair → `totalDist = Infinity`, rejected from offspring.
- [x] **T2.3** Remove Haversine fallback in `pd()` of `src/utils/nsga2.ts:65-75`; return `Infinity` when `precomputed?.[k]` is undefined. _Files:_ `src/utils/nsga2.ts`. _Verify:_ NSGA2 individual with missing pair is not added to offspring.

**Deps:** none. **Rollback:** restore `return 0`; safe because PR 1 prevents the broken-key path.
**Acceptance (spec §`strict-matrix-contract`):** `matGet` returns `Infinity` for missing key with one warning. GA `pd` with missing pair → `Infinity` propagates, candidate rejected. NSGA2 `pd` with missing pair → offspring not added.

---

## PR 3 — UI surface for unreachable POIs

**Goal:** User sees excluded POIs and can retry with a fresh provider query.

- [ ] **T3.1** Render `unreachable` section in `src/app/page.tsx` (or `src/components/ResultsPanel.tsx`) listing each POI's name + coords + "no road found" badge. _Files:_ `src/app/page.tsx`, `src/components/ResultsPanel.tsx`. _Verify:_ DOM contains the section when `unreachable.length > 0`; hidden when empty.
- [ ] **T3.2** Add "Try again" CTA that re-submits with empty `geoapifyTried` so OSRM re-queries. _Files:_ `src/app/page.tsx`. _Verify:_ click triggers POST with `geoapifyTried: []`.
- [ ] **T3.3** Confirm `Location[]` flows through `src/types/index.ts`; if richer shape needed, add `UnreachablePoi` interface (name + coords + reason). _Files:_ `src/types/index.ts`. _Verify:_ `tsc --noEmit` clean.

**Deps:** PR 1. **Rollback:** remove the section; `unreachable` data still flows.
**Acceptance (spec §`unreachable-poi-handling` + §`routing-source-tracking`):** "One unreachable" → UI lists X with badge. "All reachable" → section hidden. "Geoapify exhausted" → badge still shows, "Try again" re-queries OSRM.

---

## PR 4 — Fix reoptimizeDay matrix handling

**Goal:** Day editing uses real matrix distances and signals Haversine fallback; days with unreachable POIs are un-editable.

- [ ] **T4.1** Add `resolveDistance(a, b, locIndexMap, matrix): number | null` in `src/utils/routerOptimizer.ts` per design §PR 4 (coordinate-epsilon 1e-5 lookup; returns `null` if either index missing). _Files:_ `src/utils/routerOptimizer.ts`. _Verify:_ returns matrix value when key exists; `null` when index missing.
- [ ] **T4.2** Replace the hardcoded Haversine lambda in `reoptimizeDay` (`routerOptimizer.ts:540-541`) with `resolveDistance`; use Haversine only when `resolveDistance` returns `null`; signal `routingMode: "haversine"` on the returned `DayRoute` (extend `DayRoute` if needed). _Files:_ `src/utils/routerOptimizer.ts`, `src/types/index.ts`. _Verify:_ `reoptimizeDay(locs, home, cfg, realMatrix, 1).stops[1].distanceFromPrev === matrix[key]`.
- [ ] **T4.3** Disable drag handles in `src/app/page.tsx` for any day containing a POI in `unreachable`; show "no road" badge on the day card. _Files:_ `src/app/page.tsx`. _Verify:_ day card with unreachable POI has drag handle `pointer-events: none`.
- [ ] **T4.4** Preserve `reoptimizeDay(locations, home, config, matrix, dayNumber)` signature per spec constraint. _Files:_ none (typecheck verifies). _Verify:_ `tsc --noEmit` clean; all call sites in `page.tsx` still typecheck.

**Deps:** PR 1 (uses `unreachable` as stopgap until PR 6). **Rollback:** restore Haversine lambda.
**Acceptance (spec §`route-editing`):** "Reopt with matrix" → distances from matrix. "Reopt without matrix" → `routingMode: "haversine"`. "Day contains unreachable" → drag handle disabled + badge. "All reachable" → every day editable.

---

## PR 5 — Map visualization for estimated legs

**Goal:** Map shows which legs are real roads vs Haversine estimates; tooltips explain fallback.

- [ ] **T5.1** Add `source: "osrm" | "geoapify" | "haversine"` to `RouteLeg` in `src/app/api/routing/route.ts`; `makeStraightLine` sets `source: "haversine"` on every leg. _Files:_ `src/app/api/routing/route.ts`. _Verify:_ response when both providers fail has `legs[i].source === "haversine"`.
- [ ] **T5.2** Pass leg `source` through to `src/app/page.tsx` / `src/components/MapView.tsx`; render dashed polyline when `source === "haversine"`, solid otherwise. _Files:_ `src/app/page.tsx`, `src/components/MapView.tsx`. _Verify:_ visual inspection on a route triggering Haversine fallback.
- [ ] **T5.3** Add "no road found" tooltip on hover for any estimated leg in `MapView.tsx`. _Files:_ `src/components/MapView.tsx`. _Verify:_ tooltip shows the expected string when hovering dashed segment.

**Deps:** none. **Rollback:** remove dashed styling; legs still tagged but rendered solid.
**Acceptance (spec §`routing-source-tracking`):** "One estimated leg" → dashed + tooltip. "All real" → all solid, no tooltips. "Tiny pair < 50 m" → Haversine used, tagged `estimated`.

---

## PR 6 — Discriminated MatrixEntry

**Goal:** Replace `Record<string, number>` with `StrictMatrix`; gate via `useStrictMatrix` feature flag for zero-downtime revert.

- [ ] **T6.1** Add to `src/types/index.ts`: `RoutingSource = "real" | "estimated" | "unreachable"`; `MatrixEntry = RealEntry | EstimatedEntry | UnreachableEntry`; `StrictMatrix = Record<string, MatrixEntry>`. _Files:_ `src/types/index.ts`. _Verify:_ `tsc --noEmit` clean.
- [ ] **T6.2** Migrate `src/utils/clientRouting.ts` to return tagged `MatrixEntry` per pair; update progress counts to `realCount` / `estimatedCount`. _Files:_ `src/utils/clientRouting.ts`. _Verify:_ when `useStrictMatrix=true`, returned object has `.source` per entry.
- [ ] **T6.3** Migrate `src/utils/geoapifyMatrix.ts` to return `StrictMatrix`; per-pair source tagging (`real` for API, `estimated` for Haversine fallback). _Files:_ `src/utils/geoapifyMatrix.ts`. _Verify:_ entry has `source: "estimated"` when Geoapify returns null and Haversine used.
- [ ] **T6.4** Replace `isRealDistance` in `src/utils/routing.ts` with `classifyPair(...)` returning `RoutingSource`. _Files:_ `src/utils/routing.ts`. _Verify:_ `classifyPair(real)` → `"real"`; `classifyPair(haversine)` → `"estimated"`.
- [ ] **T6.5** Update `src/utils/routerOptimizer.ts` consumers (`matGet`, `pd`, `reoptimizeDay`) to narrow `MatrixEntry`; expose `routingMode` derived from `MatrixEntry.source`. _Files:_ `src/utils/routerOptimizer.ts`. _Verify:_ `useStrictMatrix=true` path compiles; legacy path unchanged.
- [ ] **T6.6** Update `src/utils/geneticOptimizer.ts` and `src/utils/nsga2.ts` to consume `StrictMatrix`; reject candidates when any leg is `unreachable`. _Files:_ `src/utils/geneticOptimizer.ts`, `src/utils/nsga2.ts`. _Verify:_ unreachable key → `totalDist = Infinity`; candidate discarded.
- [ ] **T6.7** Migrate `src/utils/googleRouting.ts` to new types (dead code, compile-only). _Files:_ `src/utils/googleRouting.ts`. _Verify:_ `tsc --noEmit` clean.
- [ ] **T6.8** Wire `useStrictMatrix: boolean` (default `false`) in `src/app/api/optimize/route.ts`; pass-through to builders + optimizers. _Files:_ `src/app/api/optimize/route.ts`. _Verify:_ `useStrictMatrix=false` → legacy `Record<string, number>`; `true` → `StrictMatrix`. Both code paths typecheck.
- [ ] **T6.9** Add `useStrictMatrix` to `OptimizeRequest` body and `OptimizeResponse._meta` in `src/types/index.ts`. _Files:_ `src/types/index.ts`. _Verify:_ typecheck.

**Deps:** PR 1, 2, 4, 5. **Rollback:** toggle `useStrictMatrix=false`; zero-downtime revert to `Record<string, number>`.
**Acceptance (spec §`strict-matrix-contract`):** end-to-end `StrictMatrix`; flag-off path identical to current behavior. `matGet` never returns `0` under either flag.

---

## Out-of-scope reminders

- Intra-day reachability (still gated on home→P only).
- `googleRouting.ts` activation (stays dead).
- Visual styling for `routing-source-tracking` other than the dashed polyline + tooltip.
- Removing Haversine entirely (kept for tiny pairs < 50 m and initial NN sort).
