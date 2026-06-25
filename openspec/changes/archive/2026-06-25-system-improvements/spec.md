# Spec: System Improvements (single-PR consolidation)

Delta specs for `openspec/changes/system-improvements`. Each section is a capability delta (ADDED / MODIFIED) or a new spec.

## Capabilities

| # | Capability | Kind | Source of truth |
|---|------------|------|-----------------|
| 1 | `routing-source-tracking` | MODIFIED | `openspec/specs/routing-source-tracking/spec.md` |
| 2 | `strict-matrix-contract` | MODIFIED | `openspec/specs/strict-matrix-contract/spec.md` |
| 3 | `user-interface` | MODIFIED | `openspec/specs/user-interface/spec.md` |
| 4 | `toast-notifications` | NEW | this file |
| 5 | `testing-infrastructure` | NEW | this file |

Out of scope of behavioral specs: Prettier (item 4) and `openspec/config.yaml` (item 10) — pure tooling changes, no contract impact. Tracked in `tasks.md`.

---

## 1. Delta for `routing-source-tracking`

### MODIFIED Requirements

### Requirement: Per-pair routing-source visibility

Every pair MUST be tagged `real` (OSRM/Geoapify), `estimated` (Haversine, including tiny < 50 m), or `unreachable`. The response MUST expose aggregate counts under `_meta`, MUST always set `_meta.routingMode` to one of `"osrm" | "haversine" | "api" | "geoapify"`, and the map MUST render real vs estimated legs differently. `isOptimizeMeta()` MUST pass for every successful response.
(Previously: the type declared `routingMode` but the API never wrote the field, so the guard failed and the consensus UI was dead.)

#### Scenario: `_meta.routingMode` is always populated

- GIVEN any successful optimize response
- WHEN the API builds `_meta`
- THEN `routingMode` is a non-empty string and `isOptimizeMeta(meta)` returns `true`

#### Scenario: Mode is `"haversine"` when no real road data

- GIVEN every leg is a Haversine fallback
- WHEN the response is built
- THEN `_meta.routingMode === "haversine"`

#### Scenario: Mixed matrix (happy path)

- GIVEN 80% real, 15% estimated, 5% unreachable pairs
- WHEN the response is built
- THEN counts surface under `_meta`; the map shows solid polylines for real and dashed for estimated

#### Scenario: One estimated leg

- GIVEN a route leg with no real road geometry
- WHEN the map renders
- THEN that segment is dashed (`dashArray: [2, 3]` for the route layer and `[1, 4]` for the glow layer)

#### Scenario: All legs real

- GIVEN every leg is OSRM or Geoapify
- WHEN rendered
- THEN `estimated` count is 0 and every polyline is solid

#### Scenario: Tiny pair < 50 m

- GIVEN two POIs 30 m apart
- WHEN measured
- THEN Haversine is used and the pair is tagged `estimated` (not an error)

#### Scenario: Geoapify credit exhaustion

- GIVEN Geoapify budget hit and OSRM has the data
- WHEN built
- THEN OSRM pairs are tagged `real`; Haversine-only pairs are tagged `estimated`

### ADDED Requirements

### Requirement: Routing-mode UI badge in `ResultsPanel`

`ResultsPanel` MUST render a `RoutingModeBadge` displaying `_meta.routingMode` and `_meta.unreachableCount`. The badge MUST be visible whenever `results` are shown.

#### Scenario: Badge shows mode and unreachable count

- GIVEN a response with `routingMode = "osrm"` and `unreachableCount = 2`
- WHEN `ResultsPanel` renders
- THEN the badge reads e.g. `OSRM · 2 unreachable` (localized)

#### Scenario: Badge hidden when no `_meta`

- GIVEN a response without `_meta` (legacy client)
- WHEN `ResultsPanel` renders
- THEN the badge is absent (no crash)

### Requirement: Map polyline styling for estimated routes

(Unchanged — see source spec.)

---

## 2. Delta for `strict-matrix-contract`

### MODIFIED Requirements

### Requirement: No silent fallback for missing pairs

(Unchanged — see source spec.)

### Requirement: `DistanceMatrix` is the standard contract

`DistanceMatrix = Record<string, MatrixEntry>` is the single matrix contract end-to-end. The `Config.useStrictMatrix` field, the `useStrictMatrix` request body field, and the legacy `Record<string, number>` code paths in optimizers and the API are REMOVED. Optimizers MUST read `entry.distance`; a missing or `unreachable` entry propagates `Infinity` and the candidate is rejected.
(Previously: `useStrictMatrix: false` (default) preserved the legacy `Record<string, number>` shape for zero-downtime revert; the bit-identical pre-PR-6 path was kept under the flag.)

#### Scenario: API always builds `DistanceMatrix`

- GIVEN any optimize request (no flag in body, no flag in `Config`)
- WHEN the API processes the request
- THEN the matrix is `DistanceMatrix` and `strictMatrix` is populated

#### Scenario: Optimizers read `entry.distance`

- GIVEN a `DistanceMatrix` with mixed sources
- WHEN `optimizeRoutes` and `runNSGA2` run
- THEN every pair lookup goes through `entry.distance` and the legacy `Record<string, number>` branch is gone

#### Scenario: `useStrictMatrix` field is gone

- GIVEN the new build
- WHEN `tsc --noEmit` runs
- THEN no call site references `Config.useStrictMatrix` or `useStrictMatrix` in the request body

#### Scenario: `useStrictMatrix: true` (was — now removed)

- GIVEN the new build
- WHEN a client sends `useStrictMatrix` in the body
- THEN the field is ignored (not an error), behavior matches the no-flag case

---

## 3. Delta for `user-interface`

### ADDED Requirements

### Requirement: Hook extraction from `page.tsx`

The orchestration state in `page.tsx` MUST be lifted into three custom hooks under `src/hooks/`: `useOptimizationFlow`, `useRouteEditor`, `useHomePlacement`. After extraction, `page.tsx` MUST be at most 900 lines. The hooks MUST return the same API surface as the inlined state they replace (no behavior change).
(Previously: `page.tsx` was 1364 lines with all flow / editing / home-placement state inlined.)

#### Scenario: Hooks folder exists and page shrinks

- GIVEN the refactor commits land
- WHEN `wc -l src/app/page.tsx` runs
- THEN the count is ≤ 900 AND `src/hooks/{useOptimizationFlow,useRouteEditor,useHomePlacement}.ts` exist

#### Scenario: Hook return values match the inlined behavior

- GIVEN the refactor is complete
- WHEN a hook is invoked from `page.tsx`
- THEN the returned state + callbacks match the pre-refactor behavior (verified by `build` + existing lint gates)

#### Scenario: One hook per concern

- GIVEN a hook file
- WHEN its exports are inspected
- THEN `useOptimizationFlow` owns phase + result + errors, `useRouteEditor` owns edit-mode state, `useHomePlacement` owns the placement mode flag (no cross-leakage)

---

## 4. New spec: `toast-notifications`

### Purpose

Replace `window.alert` and silent `console.error`-only catch handlers with a minimal React toast: a context + fixed-position host. No new design system — the host is a single floating element at the top-right.

### Requirements

### Requirement: Toast context + host

A `ToastProvider` MUST expose a `useToast()` hook returning `{ show: (msg: string, opts?: { kind?: "error" | "info"; durationMs?: number }) => void }`. `<ToastHost>` MUST mount once at the app root and render active toasts at a fixed position (top-right, z-index above the map). Toasts MUST auto-dismiss after ~4s by default; a manual close MUST be available.
(Previously: errors used `window.alert` (`routeExport.ts:886`) or were silently logged via `.catch(console.error)` in `page.tsx`.)

#### Scenario: `window.alert` is gone from `routeExport.ts`

- GIVEN a failing export path
- WHEN the error handler runs
- THEN a toast appears AND `window.alert` is not called (no `window.alert` references in `src/**/*.ts(x)`)

#### Scenario: Silent catch handlers surface to the user

- GIVEN a fetch in `page.tsx` rejects
- WHEN the `.catch` runs
- THEN `useToast().show(err.message, { kind: "error" })` is called AND the legacy `console.error`-only catch is removed

#### Scenario: Toast auto-dismisses

- GIVEN a toast is visible
- WHEN `durationMs` elapses (default 4000) without interaction
- THEN the toast unmounts

#### Scenario: Manual dismiss

- GIVEN a toast is visible
- WHEN the user clicks the close control
- THEN the toast unmounts immediately

---

## 5. New spec: `testing-infrastructure`

### Purpose

Add `vitest` as the test runner with `jsdom` and a minimal config. Provide smoke coverage for the two pre-filter paths, the matrix lookup, and the NSGA-II convergence. No coverage threshold or full TDD rollout — this change only proves the test harness works.

### Requirements

### Requirement: vitest configured

`package.json` MUST expose `test` (watch) and `test:run` (CI) scripts. `vitest.config.ts` MUST exist with `jsdom` environment, the `@/*` path alias resolved to `./src/*`, and TypeScript via `vite-tsconfig-paths`. Running `npm run test:run` MUST exit 0.
(Previously: no test runner, no test files, no test scripts.)

#### Scenario: Test scripts run

- GIVEN the runner is installed
- WHEN `npm run test:run` runs
- THEN vitest executes ≥ 3 test files and exits 0

#### Scenario: `vitest.config.ts` exists

- GIVEN the repo
- WHEN the config file is read
- THEN it has `environment: "jsdom"`, the `@/*` alias, and `globals: true`

### Requirement: Smoke coverage for pure helpers

Tests MUST exist for: `filterUnreachable` (legacy + strict paths in `src/utils/unreachableFilter.ts`), `matGet` (`src/utils/routerOptimizer.ts`, exported for tests), and NSGA-II convergence on a 5-POI dataset with documented bounds.
(Previously: zero tests in the repo.)

#### Scenario: `filterUnreachable` — all reachable

- GIVEN a matrix where every home→P key is finite
- WHEN `filterUnreachable` runs
- THEN `unreachable` is empty and `reachable` has all POIs

#### Scenario: `filterUnreachable` — one unreachable (strict)

- GIVEN a `DistanceMatrix` with one `source: "unreachable"` entry
- WHEN `filterUnreachable` runs
- THEN that POI appears in `unreachable` with `reason: "no_road_connection"`

#### Scenario: `matGet` returns `Infinity` for missing key

- GIVEN a matrix without the lookup key
- WHEN `matGet(a, b, matrix)` is called
- THEN it returns `Infinity` and emits exactly one `console.warn`

#### Scenario: NSGA-II converges on 5 POIs

- GIVEN 5 POIs + home with a known distance matrix
- WHEN NSGA-II runs
- THEN it returns a non-empty Pareto front AND `totalDistance` is within documented upper bound (smoke threshold)
