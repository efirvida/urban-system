# Testing Infrastructure Specification

## Purpose

Add `vitest` as the test runner with `jsdom` and a minimal config. Provide smoke coverage for the two pre-filter paths, the matrix lookup, and the NSGA-II convergence. No coverage threshold or full TDD rollout — this change only proves the test harness works.

## Requirements

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

### Out of scope

- Coverage threshold enforcement (`coverage_threshold: 0` in `openspec/config.yaml`).
- Integration / e2e / API route tests (need integration harness).
- Leaflet component tests (DOM-dependent, out of scope).
- Export function tests (side-effect heavy; manual QA).
