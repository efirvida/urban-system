# Tasks: Optimizer Strategy Pattern

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~700-900 (7 new + 4 modified files; Geoapify wrapper is the heaviest) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Delivery strategy | single-pr-default |
| Chain strategy | pending (user decides between size:exception or chained PRs) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Strategy infra + CW/NSGA-II wrappers, no behavior change | PR 1 | base = main. Adds `types.ts`/`cache.ts`/`registry.ts` + `cw.ts` + `nsga2.ts`; endpoint switches to `registry.runAll()` but legacy fields identical. `tsc` + `next lint` must stay green. |
| 2 | Geoapify Route Planner optimizer + cache wiring | PR 2 | base = PR 1. Adds `optimizers/geoapify.ts` and registers it in `optimizers/index.ts`. Needs `GEOAPIFY_API_KEY` to verify end-to-end. |
| 3 | Frontend tabs in `ResultsPanel` + `page.tsx` wiring | PR 3 | base = PR 2. Per-algorithm tabs (Geoapify hidden on null); legacy `result.days` still drives route editor. |

## Phase 1: Foundation — Optimizer infrastructure

- [x] 1.1 Create `src/utils/optimizer/types.ts` — `Optimizer` interface (`name`, `label`, `optimize(params)`), `OptimizerResult`, `OptimizeParams`
- [x] 1.2 Create `src/utils/optimizer/cache.ts` — in-memory `Map`, 24h TTL, `sha1(sorted home+locations+config JSON)` key, evict on read > 24h, log `cache hit` / `cache miss`
- [x] 1.3 Create `src/utils/optimizer/optimizers/cw.ts` — `CwOptimizer` wraps `optimizeRoutes()`; normalize to `OptimizerResult`
- [x] 1.4 Create `src/utils/optimizer/optimizers/nsga2.ts` — `Nsga2Optimizer` wraps `runNSGA2()`; pick `minDistance` as result; respect 30s timeout
- [x] 1.5 Create `src/utils/optimizer/optimizers/geoapify.ts` — translate Config+Location[] → Route Planner body, POST to `api.geoapify.com/v1/routeplanner`, parse visit order, re-split via CW day-split, distances from our matrix, 24h cache, 402/429 → null + one warn line
- [x] 1.6 Create `src/utils/optimizer/optimizers/index.ts` — export `defaultOptimizers = [CwOptimizer, Nsga2Optimizer, GeoapifyRoutePlannerOptimizer]`
- [x] 1.7 Create `src/utils/optimizer/registry.ts` — `OptimizerRegistry` with `register()` + `runAll(params)` via `Promise.allSettled`; thrown error → null slot

## Phase 2: Backend wiring

- [x] 2.1 Modify `src/types/index.ts` — add `OptimizerResult` type; add `results: OptimizerResult[]` to `OptimizeResponse` (optional, additive)
- [x] 2.2 Rewrite `src/app/api/optimize/route.ts` — replace inline CW+NSGA2 with `registry.runAll()`; best = lowest `totalDistance`, tiebreak fewer days, then registration order; preserve legacy `days`/`totalDistance`/`totalDays` as best; keep `unreachable` + `_meta` + strict-matrix path

## Phase 3: Frontend display

- [x] 3.1 Modify `src/app/page.tsx` — read `results` from API response, pass array to `ResultsPanel`, drop `_nsga2` sidebar section (no longer needed)
- [x] 3.2 Modify `src/components/ResultsPanel.tsx` — accept optional `results: OptimizerResult[]`; render one tab per non-null entry using `result.label`; default active tab = winner; Geoapify tab hidden (not disabled) on null; legacy `days` block unchanged so route editor + map still work

## Phase 4: Quality

- [x] 4.1 `npx tsc --noEmit` — must pass
- [x] 4.2 `next lint` — must pass
- [x] 4.3 Manual: load `.xlsx` with home + 5+ POIs, run optimize, verify 2-3 tabs render (3 if `GEOAPIFY_API_KEY` set, 2 otherwise) and legacy `result.days` still drives map + editor
