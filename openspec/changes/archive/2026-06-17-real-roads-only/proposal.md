# Proposal: Real Roads Only

## Intent

The VRP solver silently substitutes Haversine distance whenever OSRM or Geoapify cannot find a real road. Users see "optimal" routes that include POIs with no road access to home — a real defect that destroys trust. `routerOptimizer.ts:10-20` makes it worse: missing matrix keys return `0`, biasing every search toward the broken-key POI as if it were free.

## Scope

**In:** pre-filter unreachable POIs at API entry (new `unreachable` field); fix `matGet:0`; UI badge; `reoptimizeDay` uses the real matrix; flag Haversine-only legs in geometry; discriminated `MatrixEntry`.

**Out:** full Haversine removal (still needed for initial NN sort and pairs < 50 m); activating `googleRouting.ts` (stays dead until PR 6); single-PR type rewrite (PR 6 is intentionally last).

## Capabilities

**New:**
- `unreachable-poi-handling` — classify/reject POIs with no real road to home; surface in response + UI.
- `routing-source-tracking` — per-leg metadata; every consumer knows real vs estimated vs unreachable.
- `strict-matrix-contract` — discriminated `MatrixEntry` (`real | estimated | unreachable`); `0` is no longer a legal fallback.

**Modified:** `route-editing` — `reoptimizeDay` MUST consume the matrix (currently hardcoded to Haversine at `routerOptimizer.ts:541`).

## Approach

**Hybrid (D): pre-filter at the entry point, then progressively harden the type system.** Each slice is a stacked-to-main PR that lands independently. PR 1 ships the user-visible win without touching optimizer math. PR 6 is last because it touches every consumer.

| PR | Slice | Files | Deps |
|----|-------|-------|------|
| 1 | Pre-filter unreachable; return `unreachable: Location[]`; centralize `REAL_VS_ESTIMATED_KM` | `src/app/api/optimize/route.ts` | — |
| 2 | `matGet` returns `Infinity` (not `0`) for missing keys | `src/utils/routerOptimizer.ts` | — |
| 3 | UI badge + "Try again" CTA | `src/app/page.tsx`, `ResultsPanel.tsx` | PR 1 |
| 4 | `reoptimizeDay` uses matrix; day un-editable if any leg is unreachable | `src/utils/routerOptimizer.ts`, `src/app/page.tsx` | PR 1 or PR 6 |
| 5 | `source: "haversine"` segments → dashed polyline + tooltip | `src/app/api/routing/route.ts`, `MapView.tsx` | — |
| 6 | Discriminated `MatrixEntry`; all builders + optimizers migrate; `useStrictMatrix` flag | `src/types/index.ts` + 7 consumers | PR 1, 2, 4, 5 |

PRs 1, 2, 5 can land in any order. PR 3 needs PR 1. PR 4 ideally follows PR 6 but can land after PR 1 using the `unreachable` field as a stopgap. PR 6 is the only big-bang change and is gated by `useStrictMatrix`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/app/api/optimize/route.ts` | Modified | Pre-filter + `unreachable` field + `REAL_VS_ESTIMATED_KM` |
| `src/utils/routerOptimizer.ts` | Modified | `matGet:Infinity`; `reoptimizeDay` consumes matrix |
| `src/utils/clientRouting.ts` | Modified | Stop storing Haversine as `real`; tag `estimated` |
| `src/utils/geoapifyMatrix.ts` | Modified | Per-pair status, not flat number map |
| `src/utils/googleRouting.ts` | Modified | Migrate to new type (still dead) |
| `src/utils/geneticOptimizer.ts`, `nsga2.ts` | Modified | `pd` returns `MatrixEntry`; callers narrow |
| `src/types/index.ts` | Modified | `MatrixEntry`, `RoutingSource`, per-pair `routingMode` |
| `src/app/api/routing/route.ts` | Modified | `makeStraightLine` flags `source: "haversine"` |
| `src/app/page.tsx`, `ResultsPanel.tsx`, `MapView.tsx` | Modified | UI surfaces unreachable + dashed fallback |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Geoapify free tier (3k/day) exhausted | Med | Reuse `geoapifyTried` cache; cap retries at 100 |
| False-positive unreachable (POI has road to neighbor but not home) | Med | Gate on home→P only; intra-day in `dayViolates` after PR 6 |
| OSRM rate limit (1 req/s) | Low | Existing 5-worker pool + per-pair cache; no new call shapes |
| Threshold drift (`0.1` vs `0.01` km across 5 files) | High pre-PR 6 | Centralize `REAL_VS_ESTIMATED_KM` in PR 1 |
| PR 6 type refactor breaks `pd` numeric comparisons in GA/NSGA2 | Med | `useStrictMatrix` flag ships both paths for one release |
| 3-POI input with 1 unreachable → 2 routes + 1 box | Low | UI copy + "Try again" CTA to re-query a different provider |

## Edge Cases

- **POI reachable to neighbor but not home** — gate on home→P only; intra-day deferred to PR 6.
- **Geoapify credit exhaustion** — pre-filter does not amplify calls; relies on `geoapifyTried` cache.
- **OSRM rate limit** — no new call patterns.
- **Threshold inconsistency** — `clientRouting.ts:263` uses `0.1`; `geoapifyMatrix.ts:219` and `route.ts:87,113` use `0.01`. Centralize in PR 1.
- **Edit mode passes `undefined` matrix** (`page.tsx:236-237`) — masked by Haversine fallback; PR 4 propagates cleanly.
- **Tiny distances < 50 m** — Haversine remains source; tagged `estimated` in PR 6.

## Rollback Plan

Each PR reverts independently. PR 1: optimizer sees all POIs again (unreachable route via Haversine, no data loss). PR 2: restores `matGet:0`; acceptable because PR 1 prevents the broken-key path. PR 3: badge section removed. PR 4: `reoptimizeDay` reverts to Haversine. PR 5: dashed polyline removed. PR 6: `useStrictMatrix` flag-off returns to legacy `Record<string, number>` (zero-downtime).

## Dependencies

`openspec/specs/route-editing/spec.md` (existing) modified by `reoptimizeDay`. No new npm deps. Geoapify + OSRM (no contract changes).

## Success Criteria

- [ ] No POI in an "optimal" route lacks a real road to home; unreachable POIs appear in `unreachable` field
- [ ] `matGet` never returns `0` for a missing key
- [ ] Edit mode uses the real matrix; days containing unreachable POIs are un-editable
- [ ] Map shows dashed polyline + "no road found" tooltip on any Haversine-only leg
- [ ] `MatrixEntry` enforced end-to-end; no `Record<string, number>` remains in the optimizer path
- [ ] All 6 PRs land independently on `main` with `tsc --noEmit` and `next lint` clean
- [ ] No NSGA2 30 s timeout regression (pre-filter is O(n) per session)
