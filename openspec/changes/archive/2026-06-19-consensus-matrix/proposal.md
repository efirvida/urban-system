# Proposal: Consensus Matrix

## Intent

The routing chain is sequential — Geoapify (priority 0) → OSRM (priority 1) → `Infinity`. The first responder wins; no cross-validation. Drivers see calculated routes that disagree with Google Maps and we cannot tell "provider confident" from "provider guessed". We need a per-pair confidence signal so the optimizer prefers high-trust routes.

## Scope

### In Scope
- Parallel multi-provider matrix with reliability scoring
- `GeoapifyMatrixProvider` (`/v1/routematrix`) and `OrsMatrixProvider` (ORS `/v2/matrix/driving-car`, self-hostable)
- `ConsensusBuilder` — parallel runner + cross-reference
- `RoutingService.buildConsensusMatrix()` (opt-in alongside `buildDistanceMatrix`)
- Reliability-aware optimizer inputs

### Out of Scope
- ORS Optimization API as a 4th solver (deferred)
- Haversine fallback (`unreachable = Infinity` per `strict-matrix-contract`)
- Removing the sequential `RoutingService.route()` (kept for fast/preview)
- Changing CW / NSGA-II / GA core algorithms

## Capabilities

### New Capabilities
- `consensus-matrix`: per-pair cross-validated distance from ≥2 providers with reliability score and per-vote source tracking
- `routing-reliability`: optimizers consume `consensus.reliability` to prefer high-confidence legs and reject low-confidence ones

### Modified Capabilities
- None

## Approach

`GeoapifyMatrix` and `OrsMatrix` run in parallel per pair; on disagreement, `OsrmProvider` ties the vote (3rd). Tier priority: **Geoapify Matrix > ORS Matrix > OSRM per-pair > Infinity**. Reliability = fraction of providers agreeing within `CONSENSUS_TOLERANCE` (default 10% of distance). Each entry has distance, reliability (0-1), and a votes array. Pairs with `reliability < 0.34` (1/3) resolve to `Infinity`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/utils/routing/providers/{geoapify,ors}MatrixProvider.ts` | New | `RouteProvider` over each batch matrix API |
| `src/utils/routing/consensusBuilder.ts` | New | Parallel runner + cross-reference |
| `src/utils/routing/service.ts` | Modified | New `buildConsensusMatrix()` |
| `src/types/index.ts` | Modified | `ConsensusEntry`, `ConsensusMatrix`; `RoutingSource` adds new providers |
| `src/utils/{routerOptimizer,nsga2,geneticOptimizer}.ts` | Modified | Accept `consensusMatrix`; penalize low reliability |
| `src/app/api/optimize/route.ts`, `openspec/config.yaml` | Modified | Opt-in flag; document `ORS_API_KEY` (optional) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `ORS_API_KEY` missing or rate-limited | Med | ORS optional; Geoapify + OSRM give 2-provider consensus |
| Parallel latency ≈ 2x sequential | Med | `Promise.all` + reuse `vrp_matrix_<hash>` cache |
| Geoapify credit burn on uncached pairs | Med | Cache key includes home + provider; short-circuit on hit |
| Tolerance mis-tuned | Low | Centralize in `constants.ts` (default 10%) |
| `useStrictMatrix` consumers break | Low | `consensusMatrix` is additive; legacy `matrix` field stays |

## Rollback Plan

1. `git revert` the merge.
2. Flip opt-in API flag off — `buildDistanceMatrix()` (sequential chain) stays.
3. Optimizers fall back to existing numeric matrix read.
4. No data migration — `localStorage` cache keys stay versioned.

## Dependencies

- `GEOAPIFY_API_KEY` (existing, required), `ORS_API_KEY` (new, optional)
- `openspec/specs/strict-matrix-contract`, `openspec/specs/routing-source-tracking`

## Success Criteria

- [ ] `buildConsensusMatrix()` returns `ConsensusMatrix` with per-pair `reliability` for ≥2 providers
- [ ] 3/3 agreement → `reliability = 1.0`; 1/3 → `reliability = 0.34` and pair resolves to `Infinity`
- [ ] `votes[]` round-trips E2E through `OptimizeParams` → results panel
- [ ] Consensus mode matches or improves route accuracy vs single-provider baseline
- [ ] `tsc --noEmit` and `next lint` clean; missing `ORS_API_KEY` falls back to 2-provider mode
