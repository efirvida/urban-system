# Proposal: Optimizer Strategy Pattern

## Intent

`/api/optimize` runs CW + NSGA-II, returns only the winner; runner-up is in `_nsga2` / `_autoDistance` metadata. Users can't compare. Apply the Strategy pattern Route Planner uses so a 3rd backend — Geoapify Route Planner — drops in without touching the endpoint, and every algorithm's best result reaches the UI.

## Scope

### In Scope
- `Optimizer` interface (`name`, `label`, `optimize(params)`) in `src/utils/optimizer/strategy.ts`
- 3 impls: `CwOptimizer` (wraps `optimizeRoutes`), `Nsga2Optimizer` (wraps `runNSGA2`), `GeoapifyRoutePlannerOptimizer` (new)
- `OptimizerRegistry`: `register()` + `runAll()`. 4th algorithm = 1 file + 1 call
- Server-side in-memory cache for Geoapify (24h TTL, sha1 of sorted home+locations + config JSON)
- `/api/optimize` runs all in parallel → `results: OptimizerResult[]` + legacy `days/totalDistance/totalDays` block (still = best) for back-compat
- `ResultsPanel`: per-algorithm tabs; Geoapify tab hidden on `null`. Geoapify failure → `null`; others still surface

### Out of Scope
New endpoint, cache persistence, per-user cache, key rotation, cache UI, CW/NSGA-II algorithm changes.

## Capabilities

### New Capabilities
- `optimization-results`: per-algorithm result contract — `OptimizerResult` (algorithm, label, days, totalDistance, totalDays, totalTime), parallel-run guarantee, partial-failure semantics, back-compat winner block.

> Legacy vrp-solver spec (`openspec/changes/vrp-solver/spec.md`, never archived) defined winner-only. No prior capability in `openspec/specs/`.

### Modified Capabilities
None

## Approach

1. Add `Optimizer` + `OptimizerResult` to `src/types/index.ts` and `src/utils/optimizer/strategy.ts`. Wrap `optimizeRoutes` / `runNSGA2` with thin classes; normalize to `OptimizerResult`. No algorithm changes.
2. `geoapifyOptimizer.ts`: translate `Config + Location[]` to Route Planner `{ agents, jobs, mode }`, POST to `api.geoapify.com/v1/routeplanner`, parse visit order, re-split via CW day-split.
3. `optimizerCache.ts` (in-memory `Map`, 24h TTL) + `registry.ts` (`register()` + `runAll()`, per-optimizer `try/catch`).
4. `route.ts` calls `runAll`, picks best (lowest `totalDistance`, tiebreak: fewer days), keeps legacy fields, attaches `results[]`. `page.tsx` + `ResultsPanel` consume the array as tabs.

## Affected Areas

| Area | Impact |
|------|--------|
| `src/types/index.ts` | Modified |
| `src/utils/optimizer/` (6 files) | New |
| `src/app/api/optimize/route.ts` | Modified |
| `src/app/page.tsx` | Modified |
| `src/components/ResultsPanel.tsx` | Modified |

## Risks

| Risk | Lik | Mitigation |
|------|-----|------------|
| Geoapify credit exhaustion (~480/run, 3000/day free) | High | 24h cache; silent skip on 402/429; UI hides tab |
| Geoapify response shape drift | Med | Parse isolated; broken tab disappears |
| Frontend refactor breaks route editor | Med | Editor reads `result.days` (legacy preserved); `results[]` additive |
| Back-compat — old clients on legacy fields only | Low | Legacy fields still = best |

## Rollback Plan

1. Revert `route.ts`, `page.tsx`, `ResultsPanel.tsx` (code in git).
2. `rm -rf src/utils/optimizer/`. Drop unused `OptimizeResponse.results` in follow-up.
3. No DB migration, no data loss, no deploy ordering.

## Dependencies

- `GEOAPIFY_API_KEY` (already required; reused)
- ~480 credits/unique run; cached 24h after first hit
- No new npm packages

## Success Criteria

- [ ] `response.results` has 1 entry per registered algorithm
- [ ] Geoapify tab present iff result returned; absent (not errored) otherwise
- [ ] `tsc --noEmit` + `next lint` pass
- [ ] Repeat run within 24h logs cache hit (no Geoapify call)
- [ ] Legacy `result.days` / `result.totalDistance` still = best — no client breakage
