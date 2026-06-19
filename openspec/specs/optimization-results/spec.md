# Optimization Results Specification

## Purpose

Define the per-algorithm result contract for `/api/optimize` so every
registered optimizer's best solution reaches the UI, with parallel
execution, partial-failure semantics, and a back-compat winner block.

## Requirements

### Requirement: Optimizer interface contract

`Optimizer` MUST expose `name`, `label`, and `optimize(params)` returning
`OptimizerResult = { algorithm, label, days, totalDistance, totalDays,
totalTime }`. `algorithm` MUST be a stable id.

#### Scenario: All three registered optimizers return valid results

- GIVEN CW, NSGA-II, and Geoapify Route Planner are registered
- WHEN each `optimize(params)` runs
- THEN each returns a fully populated `OptimizerResult`

### Requirement: Three built-in optimizers

The registry MUST register `CwOptimizer` (wraps `optimizeRoutes`),
`Nsga2Optimizer` (wraps `runNSGA2`), and `GeoapifyRoutePlannerOptimizer`
(calls `api.geoapify.com/v1/routeplanner`) on startup.

#### Scenario: All three optimizers registered on startup

- GIVEN the app boots
- WHEN the registry initializes
- THEN `CwOptimizer`, `Nsga2Optimizer`, and
  `GeoapifyRoutePlannerOptimizer` are registered

### Requirement: Parallel execution with partial-failure semantics

`OptimizerRegistry.runAll()` MUST invoke every registered optimizer in
parallel. A thrown error in one optimizer MUST be caught; that slot in
`results` MUST be `null`; the request MUST still return HTTP 200.

#### Scenario: One optimizer throws, others still surface

- GIVEN CW and NSGA-II succeed and Geoapify throws
- WHEN the request completes
- THEN `results` has three slots (CW + NSGA-II populated, Geoapify `null`)
  AND the response status is 200

### Requirement: Response shape and back-compat winner block

`OptimizeResponse` MUST include `results: OptimizerResult[]`. The legacy
fields `days`, `totalDistance`, and `totalDays` MUST remain and MUST equal
the best non-null entry of `results[]`. A client reading only those legacy
fields MUST see no behavior change vs pre-change baseline.

#### Scenario: Legacy fields equal the best of results

- GIVEN `results = [cw:120, nsga2:95, geoapify:110]`
- WHEN the response is shaped
- THEN `response.days` equals `results[1].days` AND
  `response.totalDistance === 95`

### Requirement: Best selection rule

Best is the non-null entry with the lowest `totalDistance`. Ties within 1
km break by fewer `totalDays`. Further ties break by registration order.

#### Scenario: Distance tiebreak by fewer days

- GIVEN `results = [cw:100km/3d, nsga2:100km/2d]`
- WHEN best is selected
- THEN NSGA-II wins (same distance, fewer days)

### Requirement: Geoapify 24h in-memory cache

Geoapify responses MUST be cached in-memory in a `Map` keyed by
`sha1(sorted home + locations + config JSON)`. A hit within 24h MUST
return the cached result without an API call. Entries older than 24h MUST
be evicted on read.

#### Scenario: Repeat run within 24h hits the cache

- GIVEN an identical request was served 1h ago
- WHEN an identical request arrives
- THEN no Geoapify HTTP call is made AND a `cache hit` log line is emitted
- AND a request with a different `constraintValue` misses the cache and
  triggers a new API call (different key)

### Requirement: Geoapify graceful failure on credit exhaustion

On HTTP 402 or 429 from Geoapify, the `GeoapifyRoutePlannerOptimizer` MUST
return `null` (not throw) and emit one warning log. Other optimizers MUST
be unaffected.

#### Scenario: Geoapify returns 429

- GIVEN Geoapify responds with HTTP 429
- WHEN the request completes
- THEN `results` has a `null` Geoapify slot AND CW and NSGA-II slots are
  populated AND the frontend hides the Geoapify tab (not an error state)

### Requirement: Frontend per-algorithm tabs

`ResultsPanel` MUST render one tab per non-null entry in `results[]` using
`result.label` as the tab text. The Geoapify tab MUST be absent (not
disabled, not error) when the slot is `null`. The legacy `result.days`
block MUST continue to drive the route editor and map.

#### Scenario: Per-algorithm tabs render or hide correctly

- GIVEN `results = [cw, nsga2, null]`
- WHEN the panel renders
- THEN only `CW` and `NSGA-II` tabs appear AND the active tab is the
  winner (best by distance)
- AND with three non-null entries, three tabs appear (CW, NSGA-II,
  Geoapify)
