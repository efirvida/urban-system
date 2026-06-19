# Design: Consensus Matrix

## Technical Approach

`ConsensusBuilder` runs batch matrix providers in parallel, then OSRM per-pair as tie-break.
Per pair, votes are cross-referenced: providers that agree within `CONSENSUS_TOLERANCE` (10% of max distance) form a consensus. Reliability = agreeing count / active provider count. Pairs below `0.34` threshold resolve to `Infinity`. The resulting `ConsensusMatrix` is opt-in via `OptimizeParams.consensusMatrix` — the existing sequential `buildDistanceMatrix()` stays for fast/preview mode.

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Separate `BatchRouteProvider` | `buildMatrix(points) → Map<string, number\|null>`, distinct from `RouteProvider` | Batch APIs accept all points in one call; per-pair `route(a,b)` is meaningless here. Single-responsibility: different transport granularity → different interface. |
| Reliability threshold = 0.34 | `agreeingCount / activeCount < 0.34 → Infinity` | 1/3 ≈ 0.333 < 0.34 → ≥2 of 3 providers must agree. In degraded 2-provider mode, 1/2 = 0.5 passes — acceptable. |
| Consensus opt-in | `consensusMatrix?` in `OptimizeParams`; `buildDistanceMatrix()` untouched | Zero-risk: `useStrictMatrix` path stays bit-identical. Optimizers fall back to `matrix`/`strictMatrix` when field is absent. |
| Haversine excluded | `null` for unreachable, no fallback | Per `strict-matrix-contract`: silent fallback is eliminated. |
| Batch cache reuse | `localStorage` keyed by `"vrp_matrix_"` + provider + point hash | Avoids credit burn. Provider-scoped key prevents cross-contamination. |
| ORS optional | Constructor skips when `ORS_API_KEY` missing | No hard dependency. 2-provider consensus degrades gracefully. |

## Data Flow

```
Points[] ──┬→ GeoapifyMatrixProvider ──┐
           ├→ OrsMatrixProvider ───────┤ (skipped if no ORS_API_KEY)
           │      Promise.all merged   │
           │                           ▼
           │  disagree? ──→ OSRMProvider (per-pair tie-break)
           │                           │
           ▼                           ▼
      ConsensusBuilder.crossReference()
        ├─ agree within CONSENSUS_TOLERANCE (10%)
        ├─ reliability = agreement / activeCount
        ├─ < 0.34 → Infinity
        └─ bestAgreedDistance from majority block
                           │
      RoutingService.buildConsensusMatrix() → ConsensusMatrix
                           │
              OptimizeParams.consensusMatrix
                           │
              CwOptimizer / Nsga2Optimizer
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/utils/routing/providers/geoapifyMatrix.ts` | **New** | `GeoapifyMatrixProvider` — POST `/v1/routematrix`, returns `Map<string, number\|null>`, priority `-1` |
| `src/utils/routing/providers/orsMatrix.ts` | **New** | `OrsMatrixProvider` — POST `/v2/matrix/driving-car`, returns `Map<string, number\|null>`, priority `0.5`, skips on missing `ORS_API_KEY` |
| `src/utils/routing/providers/index.ts` | Modify | Export `batchProviders` array alongside `defaultProviders` |
| `src/utils/routing/consensusBuilder.ts` | **New** | `ConsensusBuilder` class — parallel batch runner, per-pair fallback, cross-reference |
| `src/utils/routing/types.ts` | Modify | Add `RoutingSourceExtended`, `ProviderVote`, `ConsensusEntry`, `ConsensusMatrix`, `BatchRouteProvider` |
| `src/utils/routing/service.ts` | Modify | Add `buildConsensusMatrix(points): Promise<ConsensusMatrix>`, delegate to `ConsensusBuilder` |
| `src/types/index.ts` | Modify | Add `ConsensusEntry`, `ConsensusMatrix`, `ProviderVote`, `RoutingSourceExtended` |
| `src/utils/constants.ts` | Modify | Add `CONSENSUS_TOLERANCE = 0.10` |
| `src/utils/optimizer/types.ts` | Modify | Add `consensusMatrix?: ConsensusMatrix` to `OptimizeParams` |
| `src/utils/optimizer/optimizers/cw.ts` | Modify | Read `consensusMatrix.reliability` to penalize low-confidence legs |
| `src/utils/optimizer/optimizers/nsga2.ts` | Modify | Same reliability-aware lookup |
| `src/app/api/optimize/route.ts` | Modify | Accept `useConsensus?: boolean` flag, pass `consensusMatrix` to optimizers |

## Interfaces / Contracts

```typescript
// New in src/utils/routing/types.ts
export type RoutingSourceExtended =
  "geoapify-matrix" | "ors-matrix" | "osrm" | "unreachable";

export interface BatchRouteProvider {
  readonly name: string;
  readonly priority: number;
  buildMatrix(points: Point[]): Promise<Map<string, number | null>>;
}

// New in src/types/index.ts
export interface ProviderVote {
  provider: RoutingSourceExtended;
  distance: number | null;
}

export interface ConsensusEntry {
  distance: number;
  reliability: number;     // 0.0–1.0
  votes: ProviderVote[];
  source: RoutingSourceExtended;
}

export type ConsensusMatrix = Record<string, ConsensusEntry>;
```

```typescript
// ConsensusBuilder API
class ConsensusBuilder {
  constructor(
    batchProviders: BatchRouteProvider[],
    perPairProvider: RouteProvider        // OSRM only
  )
  async build(points: Point[]): Promise<ConsensusMatrix>
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Type safety | All new types compile, no `any` escapes | `tsc --noEmit` with strict mode |
| Lint | No dead code, unused imports, ESLint rules | `next lint` (eslint-config-next) |
| Contract | `OptimizeParams` backward compat (missing `consensusMatrix` → no-op) | Manual verification via existing UI flow |
| Integration | `buildConsensusMatrix()` returns matrix with ≥2 providers | Manual with `console.table()` output |

No test runner available (`strict_tdd: false`). Verification is `tsc --noEmit && next lint`.

## Migration / Rollout

- Feature-gated by `useConsensus?: boolean` in API request body (`false` by default).
- `buildDistanceMatrix()` (sequential chain) stays — flip flag off for instant rollback.
- `localStorage` matrix cache keys are provider-scoped — no migration needed.

## Open Questions

- [ ] ORS self-hosting: Docker Compose setup vs external `ORS_API_KEY` — which ships first?
- [ ] `CONSENSUS_TOLERANCE` tuning: 10% is pragmatic but field data may suggest tighter (e.g., 5% for urban).
- [ ] Map display of reliability: show `consensus.reliability` as a route badge or color gradient? Deferred to UI phase.
