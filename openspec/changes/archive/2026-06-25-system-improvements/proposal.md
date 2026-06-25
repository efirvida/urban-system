# Proposal: System Improvements (single-PR consolidation)

## Intent

Close 10 quality gaps from the recent PR chain in one PR (800-line budget approved): dead consensus UI (missing `_meta.routingMode`), `useStrictMatrix` default-off, `window.alert` in `routeExport.ts:886`, zero tests, no formatter, 1364-line `page.tsx`, silent routing telemetry.

## Scope

### In Scope
- API: set `_meta.routingMode` + per-source counts; drop legacy matrix path; activate `DistanceMatrix` contract
- UI: toast system; routing-mode badge in `ResultsPanel`; extract 3 hooks from `page.tsx`
- Tooling: Prettier + scripts; vitest + config; openspec config updated
- Tests: smoke coverage for `unreachableFilter`, `matGet`, NSGA-II

### Out of Scope
Intra-day reachability, new providers, map style, new export formats.

## Capabilities

### New Capabilities
- `testing-infrastructure`: vitest config + smoke tests
- `toast-notifications`: minimal toast replacing `window.alert` and silent `.catch(console.error)`

### Modified Capabilities
- `routing-source-tracking`: `_meta.routingMode` required; UI badge surfaces mode + counts
- `strict-matrix-contract`: `DistanceMatrix` is standard; `useStrictMatrix` flag removed
- `user-interface`: `page.tsx` decomposed into 3 custom hooks under `src/hooks/`

## Approach

1. **API** — add `routingMode` + per-source counts to `_meta` (`route.ts:252`); drop legacy matrix path; make `DistanceMatrix` mandatory.
2. **UI** — `useToast` + `<ToastHost>`; `<RoutingModeBadge>` in `ResultsPanel`; extract 3 hooks from `page.tsx`.
3. **Tooling** — Prettier pinned to existing style; vitest + jsdom.
4. **Tests** — `unreachableFilter` (legacy + strict), `matGet` (Infinity), NSGA-II (5-POI).

## Affected Areas

| Area | Impact |
|------|--------|
| `src/app/api/optimize/route.ts`, `src/types/index.ts` | Modified |
| `src/app/page.tsx` | Modified (state lifted into 3 hooks) |
| `src/lib/routeExport.ts` | Modified (toast) |
| `src/utils/{routerOptimizer,geneticOptimizer,nsga2}.ts` | Modified (legacy path removed) |
| `src/hooks/{useOptimizationFlow,useRouteEditor,useHomePlacement}.ts` | New |
| `src/components/{ToastHost,RoutingModeBadge}.tsx` | New |
| `src/utils/{unreachableFilter,routerOptimizer,nsga2}.test.ts`, `vitest.config.ts`, `.prettierrc` | New |
| `package.json`, `openspec/config.yaml` | Modified |

## Risks

| Risk | Mit |
|------|-----|
| Strict-matrix removal breaks callers | Single commit + audit; `isOptimizeMeta` already guards |
| Hook extraction regressions | One hook per commit, `build` after each |
| Prettier sweep inflates diff | LAST commit, config pinned to existing style |
| Single PR ≈ 800 LOC | Budget approved; `work-unit-commits` keeps commits reviewable |

## Rollback Plan

Each commit independently revertible. Order: tooling → API bugfix → toast → badge → hooks → strict-matrix → Prettier. Whole-PR revert via `git revert`. `useStrictMatrix` removal is highest-risk — kept last.

## Dependencies

New devDeps only: `vitest`, `prettier`, `jsdom`. No runtime deps.

## Success Criteria

> Reconciled at archive (2026-06-25, sdd-archive): all 5 criteria met. The
> verify-report (engram obs #1430) confirms every line below with
> file:line evidence and the full quality-gate table.

- [x] `build && lint && type-check && test:run` pass; `prettier --check` clean
- [x] `_meta.routingMode` populated; `Config.useStrictMatrix` removed; legacy path deleted
- [x] `window.alert` replaced with toast; `page.tsx` ≤ 900 lines
- [x] `test:run` runs ≥ 3 vitest files; routing-mode badge visible
- [x] openspec config updated; total diff (excluding Prettier commit) ≤ 800 lines
