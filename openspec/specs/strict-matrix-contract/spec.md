# Strict Matrix Contract Specification

## Purpose

Eliminate silent fallback. Missing matrix keys MUST propagate `Infinity` (never `0`) so the optimizer rejects the candidate instead of biasing toward a broken-key POI. The legacy `Record<string, number>` shape remains available via a feature flag for zero-downtime revert; the `MatrixEntry` discriminated shape is the long-term contract.

## Requirements

### Requirement: No silent fallback for missing pairs

`matGet` MUST return `Infinity` (never `0`) for any missing key. The `pd()` helpers in `geneticOptimizer.ts` and `nsga2.ts` MUST NOT silently substitute Haversine when a matrix is supplied but a key is missing — the absence MUST propagate so the optimizer rejects the candidate.

#### Scenario: `matGet` returns Infinity for missing key

- GIVEN no `a,b` entry in the matrix
- WHEN `matGet(a, b, matrix)` is called
- THEN it returns `Infinity` and emits a single `console.warn`

#### Scenario: GA `pd` with missing pair

- GIVEN a GA step looks up a pair not in the matrix
- WHEN the step runs
- THEN `Infinity` propagates into `totalDist` and the candidate is rejected

#### Scenario: NSGA2 `pd` with missing pair

- GIVEN an NSGA2 route evaluation hits a missing pair
- WHEN evaluated
- THEN the route is rejected; the offspring is not added

#### Scenario: Tiny pair < 50 m is fine

- GIVEN two POIs 30 m apart with no matrix entry
- WHEN measured
- THEN `pd` returns Haversine (still allowed) and the matrix is unchanged

#### Scenario: OSRM timeout never reaches the optimizer

- GIVEN OSRM returns null for a pair
- WHEN pre-filtered at API entry
- THEN the POI is removed via `unreachable-poi-handling` and the optimizer never sees the missing key

### Requirement: Discriminated `MatrixEntry` gated by `useStrictMatrix`

When `useStrictMatrix: true` is passed in the request, the API builds a `DistanceMatrix = Record<string, MatrixEntry>` where each `MatrixEntry` carries `{ distance, source: "real" | "estimated" | "unreachable" }`. Consumers (optimizers + downstream UI) read `entry.distance` and discriminate on `entry.source`. When the flag is `false` (default), every code path is bit-identical to the legacy `Record<string, number>` flow.

#### Scenario: `useStrictMatrix: false` (default)

- GIVEN the request omits `useStrictMatrix` or sets it to `false`
- WHEN the API processes the request
- THEN the matrix is `Record<string, number>`, the optimizer reads the number directly, and behavior matches the pre-change baseline

#### Scenario: `useStrictMatrix: true`

- GIVEN the request sets `useStrictMatrix: true`
- WHEN the API processes the request
- THEN the matrix is `Record<string, MatrixEntry>`, `optimizeRoutes` and `runNSGA2` resolve distances via `entry.distance`, and any missing or `unreachable` entry yields `Infinity` (rejecting the candidate)

### Constraints

- `0` MUST NOT appear in any `matGet` return path.
- The legacy `Record<string, number>` shape stays available as long as `useStrictMatrix: false` is a supported configuration.
- `googleRouting.ts` remains dead code; the legacy `Record<string, number>` return type is preserved so the type migration does not break the compile.

### Out of scope

- Removing Haversine entirely (kept for tiny pairs < 50 m and initial NN sort).
- Activating `googleRouting.ts`.
