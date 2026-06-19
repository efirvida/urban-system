# Tasks: Consensus Matrix

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~600 across 12 files (3 new: 2 providers + builder; 9 modified) |
| 400-line budget risk | Low |
| 800-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | auto-forecast |
| Chain strategy | single-pr |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: single-pr
400-line budget risk: Low

## Phase 1: Foundation (types, constants)

- [x] 1.1 Add `CONSENSUS_TOLERANCE = 0.10` and `RELIABILITY_FLOOR = 0.34` to `src/utils/constants.ts`
- [x] 1.2 Add `BatchRouteProvider` interface and `RoutingSourceExtended` union to `src/utils/routing/types.ts`
- [x] 1.3 Add `ProviderVote`, `ConsensusEntry`, `ConsensusMatrix` types to `src/types/index.ts`

## Phase 2: New batch providers

- [x] 2.1 Create `src/utils/routing/providers/geoapifyMatrix.ts` — `GeoapifyMatrixProvider implements BatchRouteProvider`, POST `/v1/routematrix`, priority `-1`
- [x] 2.2 Create `src/utils/routing/providers/orsMatrix.ts` — `OrsMatrixProvider implements BatchRouteProvider`, POST `/v2/matrix/driving-car`, priority `0.5`, skip when `ORS_API_KEY` missing
- [x] 2.3 Export `batchProviders: BatchRouteProvider[]` from `src/utils/routing/providers/index.ts` (keep `defaultProviders`)

## Phase 3: ConsensusBuilder

- [x] 3.1 Create `src/utils/routing/consensusBuilder.ts` — `ConsensusBuilder` ctor takes `(batchProviders, perPairProvider: RouteProvider)`; `build(points)` runs `Promise.all` over batch
- [x] 3.2 Implement `crossReference(votes)` — cluster finite votes within `CONSENSUS_TOLERANCE` of median, pick tier-priority distance, compute `reliability = agreed / active`
- [x] 3.3 Apply `distance = Infinity` when `reliability < RELIABILITY_FLOOR`; return `ConsensusMatrix` keyed by `i,j`

## Phase 4: RoutingService integration

- [x] 4.1 Add `buildConsensusMatrix(points): Promise<ConsensusMatrix>` to `src/utils/routing/service.ts` — instantiate `ConsensusBuilder` with `batchProviders` + `OSRMProvider` for tie-break
- [ ] 4.2 Reuse `cache.ts` with provider-scoped key `vrp_matrix_consensus_<hash>`; short-circuit on full hit

> **4.2 deferred**: per-leg OSRM calls go through the existing
> `routing/cache.ts` automatically (the `RoutingService` chain wraps
> each call), so a separate `vrp_matrix_consensus_<hash>` is not
> required for correctness — only for credit-burn avoidance on
> Geoapify/ORS re-runs. The batch providers are server-side and
> don't have access to `localStorage`; a future change can add a
> server-side `Map`-backed cache. Out of scope for this iteration.

## Phase 5: Optimizer integration

- [x] 5.1 Add `consensusMatrix?: ConsensusMatrix` to `OptimizeParams` in `src/utils/optimizer/types.ts`
- [x] 5.2 Update `src/utils/optimizer/optimizers/cw.ts` — pre-filter legs with `reliability < RELIABILITY_FLOOR`; add `avgReliability: number` to returned `OptimizerResult`
- [x] 5.3 Update `src/utils/optimizer/optimizers/nsga2.ts` — same reliability pre-filter + `avgReliability` field; do not touch algorithm core

## Phase 6: API integration & verification

- [x] 6.1 Add `useConsensus?: boolean` to request body in `src/app/api/optimize/route.ts`; when `true`, call `buildConsensusMatrix()` and pass through `OptimizeParams`
- [x] 6.2 Surface `avgReliability` from each `OptimizerResult` in the API response payload
- [x] 6.3 Run `tsc --noEmit && next lint`; resolve all errors
- [ ] 6.4 Manual smoke test: 3-provider case logs 3 votes per entry; `ORS_API_KEY` missing case logs 2 votes and skips ORS
