# Delta Specs: real-roads-only

Four capabilities. Reject Haversine-as-real where it poisons the optimizer; never silently substitute when a real road is missing.

---

## ADDED — `unreachable-poi-handling`

### Requirement: Pre-filter unreachable POIs at API entry

The system MUST classify each POI as reachable or unreachable, exclude unreachable POIs from optimization, and return them in a new `unreachable: Location[]` field. The gate is `home → P` only; intra-day reachability is deferred to PR 6.

#### Scenario: All POIs reachable (happy path)

- GIVEN 5 POIs all connected to home by a real road
- WHEN the user submits optimization
- THEN `days` covers all 5; `unreachable` is empty

#### Scenario: One POI unreachable

- GIVEN 4 reachable POIs plus POI X with no road from home
- WHEN submitted
- THEN `unreachable` contains X with name + coords; `days` covers only the 4

#### Scenario: All POIs unreachable

- GIVEN every POI is isolated
- WHEN submitted
- THEN `days` is `[]`; `unreachable` lists all; HTTP status is 200

#### Scenario: Geoapify credits exhausted

- GIVEN `geoapifyTried` already covers every pair
- WHEN submitted
- THEN no new Geoapify calls; OSRM is the primary reachability source

#### Scenario: OSRM timeout

- GIVEN OSRM returns null for `home → P`
- WHEN submitted
- THEN P is placed in `unreachable`; the optimizer never sees it

### Constraints
- `unreachable` is additive — existing response shape MUST stay backward-compatible.
- `reoptimizeDay` signature MUST NOT change.

### Out of scope
- Intra-day reachability (PR 6). UI badge (`routing-source-tracking`).

---

## ADDED — `routing-source-tracking`

### Requirement: Per-pair routing-source visibility

Every pair MUST be tagged `real` (OSRM/Geoapify), `estimated` (Haversine, including tiny < 50 m), or `unreachable`. The response MUST expose aggregate counts; the map MUST render real vs estimated legs differently.

#### Scenario: Mixed matrix (happy path)

- GIVEN 80% real, 15% estimated, 5% unreachable pairs
- WHEN the response is built
- THEN counts surface under `_meta`; map shows solid polylines for real, dashed for estimated

#### Scenario: One estimated leg

- GIVEN a route leg with no road geometry
- WHEN the map renders
- THEN that segment is dashed and shows a "no road found" tooltip

#### Scenario: All legs real

- GIVEN every leg is OSRM or Geoapify
- WHEN rendered
- THEN `estimated` count is 0; every polyline is solid

#### Scenario: Tiny pair < 50 m

- GIVEN two POIs 30 m apart
- WHEN measured
- THEN Haversine is used; the pair is tagged `estimated` (not an error)

#### Scenario: Geoapify credit exhaustion

- GIVEN Geoapify budget hit; OSRM has the data
- WHEN built
- THEN OSRM pairs are tagged `real`; Haversine-only pairs are tagged `estimated`

### Constraints
- Source tag is per pair, never per request. Tiny pairs (< 50 m) MUST stay on Haversine.

### Out of scope
- Live reclassification on provider recovery. Visual styling (PR 5 design).

---

## ADDED — `route-editing` — Matrix-aware day reoptimization

### Requirement: `reoptimizeDay` consumes the matrix; signals Haversine fallback

`reoptimizeDay` MUST use the supplied matrix when present. With no matrix, the system MUST signal `routingMode: "haversine"` instead of silently substituting. Days containing an unreachable leg MUST be un-editable.

#### Scenario: Reopt with matrix (happy path)

- GIVEN a day with 3 POIs and a real-distance matrix
- WHEN the user adds POI X
- THEN distances in the returned `DayRoute` come from the matrix

#### Scenario: Reopt without matrix

- GIVEN no matrix was computed
- WHEN the user adds POI Y
- THEN the response signals `routingMode: "haversine"`; the UI surfaces that warning

#### Scenario: Day contains unreachable POI

- GIVEN a day that includes an unreachable POI
- WHEN the user opens edit mode
- THEN that day's drag handles are disabled; a "no road" badge is visible

#### Scenario: All POIs reachable

- GIVEN every POI has a real road from home
- WHEN edit mode opens
- THEN every day is fully editable; no badge

#### Scenario: Every day un-editable

- GIVEN every day contains an unreachable POI
- WHEN edit mode opens
- THEN edit mode mounts; every day is locked; a global "no roads found" notice is shown

### Constraints
- `reoptimizeDay(locations, home, config, matrix, dayNumber)` signature MUST stay the same.
- `Apply` / `Discard` / `Undo` semantics MUST NOT change.

### Out of scope
- Internal NN + 2-opt algorithm. Per-leg visual flags (`routing-source-tracking`).

---

## ADDED — `strict-matrix-contract`

### Requirement: No silent fallback for missing pairs

`matGet` MUST return `Infinity` (never `0`) for any missing key. The `pd()` helpers in `geneticOptimizer.ts` and `nsga2.ts` MUST NOT silently substitute Haversine when a matrix is supplied but a key is missing — the absence MUST propagate so the optimizer rejects the candidate.

#### Scenario: `matGet` returns Infinity for missing key

- GIVEN no `a,b` entry in the matrix
- WHEN `matGet(a, b, matrix)` is called
- THEN it returns `Infinity`; a single warning is logged

#### Scenario: GA `pd` with missing pair

- GIVEN a GA step looks up a pair not in the matrix
- WHEN the step runs
- THEN `Infinity` propagates into `totalDist`; the candidate is rejected

#### Scenario: NSGA2 `pd` with missing pair

- GIVEN an NSGA2 route evaluation hits a missing pair
- WHEN evaluated
- THEN the route is rejected; the offspring is not added

#### Scenario: Tiny pair < 50 m is fine

- GIVEN two POIs 30 m apart; no matrix entry
- WHEN measured
- THEN `pd` returns Haversine (still allowed); matrix is unchanged

#### Scenario: OSRM timeout never reaches the optimizer

- GIVEN OSRM returns null for a pair
- WHEN pre-filtered at API entry
- THEN the POI is removed via `unreachable-poi-handling`; the optimizer never sees the missing key

### Constraints
- `0` MUST NOT appear in any `matGet` return path.
- Legacy `Record<string, number>` shape stays until PR 6 introduces `MatrixEntry`.

### Out of scope
- Full `MatrixEntry` rewrite (PR 6, gated by `useStrictMatrix`). `googleRouting.ts` activation.
