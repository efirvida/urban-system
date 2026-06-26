# Verify Report: System Improvements (single-PR consolidation)

**Date:** 2026-06-25
**Verifier:** sdd-verify (minimax-m3)
**Change:** `system-improvements` (13 commits, single PR)

## Quality gates

| Gate | Command | Result |
|------|---------|--------|
| Type check | `npm run type-check` | PASS (0 errors) |
| Lint | `npm run lint` | PASS (1 pre-existing warning in `MapView.tsx:137` — `react-hooks/exhaustive-deps`, not introduced by this change) |
| Build | `npm run build` | PASS (`✓ Compiled successfully`, 7/7 static pages, route bundle 435 kB) |
| Tests | `npm run test:run` | PASS — 3 test files, **10/10 tests green** in 11.23 s |
| Prettier | `npm run format:check` | PASS — `All matched files use Prettier code style!` |

## Per-criterion results

| # | Area | Verdict | Evidence |
|---|------|---------|----------|
| 1 | `_meta.routingMode` fix | **PASS** | `route.ts:287` sets `routingMode`; `isOptimizeMeta()` at `types/index.ts:38` requires `typeof m.routingMode === 'string'`; the guard is used by `RoutingModeBadge.tsx:31` and by `useOptimizationFlow.ts:345`. Counts (`realCount`, `estimatedCount`, `unreachableInMatrixCount`, `unreachableCount`) are also populated. |
| 2 | `useStrictMatrix` removed (default strict) | **PASS** | `Config` interface in `types/index.ts:93-101` no longer contains `useStrictMatrix`. `_meta` no longer echoes it. `route.ts:45-46` explicitly accepts and ignores the field from older clients. `geneticOptimizer.ts:22-39` and `nsga2.ts:90-98` `pd()` functions read **only** the strict matrix (no `if (strictMatrix)` branch). The only remaining references are in comments documenting the back-compat behavior. `rg "useStrictMatrix" src` → 0 functional hits. |
| 3 | Toast notifications | **PASS** | `src/lib/toast.tsx` exposes `useToast(): { show(msg, opts?) }` with default duration 4000 ms. `src/components/ToastHost.tsx` mounts at `fixed top-4 right-4 z-50`, supports auto-dismiss and × close. Mounted in `layout.tsx:24-27`. `page.tsx:62-69` exposes `notify()` and `reportExportError`. `routeExport.ts:858, 862, 864` accepts an `onError` callback and no longer calls `window.alert`. `rg "window\.alert" src` → 0 matches. |
| 4 | Prettier | **PASS** | `.prettierrc` matches spec (singleQuote, trailingComma all, printWidth 100, tabWidth 2, semi, arrowParens). `format` and `format:check` scripts in `package.json:13-14`. `prettier ^3.8.4` in devDeps. `format:check` exits 0 across `src/**/*.{ts,tsx,js,jsx,json,css,md}` and root `.md`/`.json`. Two dedicated commits (`e0da70f` + `7074770`) at the END of the chain, as the design mandated. |
| 5 | vitest | **PASS** | `vitest.config.ts` has `environment: "jsdom"`, `globals: true`, `@/*` via `vite-tsconfig-paths`, and `include: ["src/**/*.{test,spec}.{ts,tsx}"]`. `package.json` has `test` and `test:run` scripts. `vitest ^4.1.9`, `jsdom ^29.1.1`, `vite-tsconfig-paths ^6.1.1` in devDeps. **3 test files / 10 tests** pass. The NSGA-II smoke runs in <2 s per spec. |
| 6 | Hook extraction | **PASS** | `page.tsx` is **556 lines** (spec target ≤ 900, design target ≤ 800). The three hooks exist: `src/hooks/useOptimizationFlow.ts` (18.6 kB), `src/hooks/useRouteEditor.ts` (11.5 kB), `src/hooks/useHomePlacement.ts` (1.9 kB). Barrel at `src/hooks/index.ts`. `page.tsx:30` imports them via `@/hooks`. Build is green, so the wiring is correct. |
| 7 | `RoutingModeBadge` | **PASS** | `src/components/RoutingModeBadge.tsx` (70 lines) renders a colored pill (geoapify/osrm/api/haversine) plus an unreachable-count chip. Guarded by `isOptimizeMeta()` — returns `null` when meta is missing. `ResultsPanel.tsx:8, 161` imports and renders it next to the global summary header. |
| 8 | Error handling (no `window.alert`, no silent `.catch(console.error)`) | **PASS** | `rg "window\.alert" src` → 0. `rg "\.catch\(console\.error\)" src` → 0. Background errors in `page.tsx` and `useOptimizationFlow.ts` (lines 188, 194, 371, 390, 414) all route through `notify?.(msg, 'error')` → toast. Export errors route through the new `onError` callback (verified in `routeExport.ts:858-864` and `page.tsx:248-258`). |
| 9 | NSGA-II convergence test | **PASS** | `src/utils/nsga2.test.ts` (90 lines) seeds a 5-POI `DistanceMatrix` with 15 entries (0.12–0.39 km each), calls `runNSGA2` with `constraintValue: 4h`, `avgSpeed: 60`, `visitTime: 15`. First test asserts non-empty Pareto front and finite `totalDistance` within a 4 km upper bound. Second test asserts `maxDayHours <= 4h + visitTime/60 + 0.5` (constraint respected). Both tests pass deterministically (1977 ms / 1630 ms). |
| 10 | `openspec/config.yaml` updated | **PASS** | `testing:` block at lines 54-79 declares `runner.command: "npm run test:run"`, `framework: "vitest"`, layer availability, linter/type-checker/formatter entries. `verify.test_command` and `apply.test_command` both reference `npm run test:run`. Tooling note added: `Prettier (prettier --check)`. |

## Issues found

### WARNING — source-of-truth spec files were not updated

The design (ADR-3 + "File Changes" table at design.md:155-156) and the delta spec (spec.md §2) explicitly state that two **source-of-truth** spec files in `openspec/specs/` were supposed to be updated, but they were not:

- `openspec/specs/strict-matrix-contract/spec.md` lines 43-62 still contain the "Discriminated `MatrixEntry` gated by `useStrictMatrix`" requirement and the legacy `useStrictMatrix: false` (default) scenario. The implementation has removed the flag entirely; the source spec is now stale.
- `openspec/specs/routing-source-tracking/spec.md` does **not** carry the new requirement that `_meta.routingMode` MUST always be populated (spec.md §1 ADDED Requirements). It also still says "the `routingMode` bottom-left badge" (line 66) even though the badge is top-right in `ResultsPanel`.

This is a SHOULD-level violation: the code matches the delta spec, but the source-of-truth specs will mislead anyone running `sdd-archive` next. **Action recommended:** update both source specs before the archive phase, otherwise the archive will copy stale text.

### SUGGESTION — vite-tsconfig-paths is now native

`npm run test:run` emits: `The plugin "vite-tsconfig-paths" is detected. Vite now supports tsconfig paths resolution natively via the resolve.tsconfigPaths option.` The current config works, but the devDep can be dropped in a follow-up by switching to `resolve: { tsconfigPaths: true }` inside `defineConfig({ test: {...} })`.

### SUGGESTION — pre-existing lint warning is unrelated

`MapView.tsx:137` has a `react-hooks/exhaustive-deps` warning that was present before this change. Not a regression; tracked only for completeness.

## Summary

| Status | Count |
|--------|-------|
| PASS | 10 |
| CRITICAL | 0 |
| WARNING | 1 |
| SUGGESTION | 2 |

**Verdict: PASS WITH WARNINGS** — the implementation is spec-conformant and all quality gates are green. The only blocker for the archive phase is the stale source-spec files; the implementation itself is correct and ready to ship.

## Next step

`fixes-required` on the source-of-truth specs only:

1. `openspec/specs/strict-matrix-contract/spec.md` — drop the `useStrictMatrix` requirement and the legacy-fallback scenarios; replace with the new "DistanceMatrix is the standard contract" requirement.
2. `openspec/specs/routing-source-tracking/spec.md` — add the new `routingMode` requirement and update the badge location text (bottom-left → top-right of `ResultsPanel`).

After those two edits, the change is **ready-for-archive**.
