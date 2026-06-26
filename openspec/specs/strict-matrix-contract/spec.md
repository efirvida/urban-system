# Strict Matrix Contract Specification

## Purpose

Eliminate silent fallback. Missing matrix keys MUST propagate `Infinity` (never `0`) so the optimizer rejects the candidate instead of biasing toward a broken-key POI. `DistanceMatrix = Record<string, MatrixEntry>` is the single, mandatory matrix contract end-to-end. The legacy `Record<string, number>` shape, the `useStrictMatrix` request flag, and the `Config.useStrictMatrix` knob were REMOVED in the `system-improvements` change; backward compatibility is handled by silently ignoring any incoming `useStrictMatrix` field on the request body.

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

#### Scenario: Tiny pair < 50 m

- GIVEN two POIs 30 m apart
- WHEN the matrix is built
- THEN the entry is pre-populated with the Haversine distance and tagged `source: "estimated"`; `pd` reads `entry.distance` directly (no Haversine fallback inside the optimizer)

#### Scenario: OSRM timeout never reaches the optimizer

- GIVEN OSRM returns null for a pair
- WHEN pre-filtered at API entry
- THEN the POI is removed via `unreachable-poi-handling` and the optimizer never sees the missing key

### Requirement: `DistanceMatrix` is the standard contract

`DistanceMatrix = Record<string, MatrixEntry>` is the single matrix contract end-to-end. Every optimize request builds a `DistanceMatrix` and every optimizer (`optimizeRoutes`, `runNSGA2`) reads distances via `entry.distance`. The `Config.useStrictMatrix` field, the `useStrictMatrix` request body field, and the legacy `Record<string, number>` code paths in optimizers and the API are REMOVED. A missing or `unreachable` `MatrixEntry` propagates `Infinity` and the candidate is rejected. Any incoming `useStrictMatrix` field on the request body is silently ignored for backward compatibility with older clients.
(Previously: `useStrictMatrix: false` (default) preserved the legacy `Record<string, number>` shape for zero-downtime revert; the bit-identical pre-PR-6 path was kept under the flag.)

#### Scenario: API always builds `DistanceMatrix`

- GIVEN any optimize request (no `useStrictMatrix` in body, no `useStrictMatrix` in `Config`)
- WHEN the API processes the request
- THEN the matrix is `DistanceMatrix` and `strictMatrix` is populated in the response

#### Scenario: Optimizers read `entry.distance`

- GIVEN a `DistanceMatrix` with mixed sources
- WHEN `optimizeRoutes` and `runNSGA2` run
- THEN every pair lookup goes through `entry.distance` and the legacy `Record<string, number>` branch is gone

#### Scenario: `useStrictMatrix` field is gone

- GIVEN the new build
- WHEN `tsc --noEmit` runs
- THEN no call site references `Config.useStrictMatrix` or `useStrictMatrix` in the request body
- AND `rg "useStrictMatrix" src` returns 0 functional hits (only documentation comments may remain)

#### Scenario: Legacy `useStrictMatrix: true` from older clients

- GIVEN a client built before the flag was removed
- WHEN the request still carries `useStrictMatrix: true`
- THEN the field is silently ignored and behavior matches the no-flag case (strict matrix is always built)

### Constraints

- `0` MUST NOT appear in any `matGet` return path.
- `DistanceMatrix` is the only matrix shape produced by the API and consumed by the optimizers. Legacy `Record<string, number>` consumers (e.g. the ORS/Geoapify optimizer adapters) keep the flat-matrix type at the seam, but the API never returns that shape.
- The `useStrictMatrix` request field and the `Config.useStrictMatrix` knob are not part of the public contract. The field is parsed and discarded; no client-visible knob exists.
- `googleRouting.ts` remains dead code.

### Out of scope

- Removing Haversine entirely (kept for tiny pairs < 50 m and initial NN sort, always pre-populated as `MatrixEntry` with `source: "estimated"`).
- Activating `googleRouting.ts`.
