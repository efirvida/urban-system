# Proposal: Route Calculation Refactor

## Intent

Two parallel routing stacks: frontend OSRM per-pair (`clientRouting.ts`) and backend Geoapify Route Matrix override (`geoapifyMatrix.ts`). The backend replaces OSRM distances in the matrix but never the UI, so display and optimizer totals disagree. Collapse both into one path: per-pair `POST /api/routing` (Geoapify → OSRM) with a per-leg localStorage cache. No Haversine fallback, no Geoapify matrix API.

## Scope

### In Scope
- Rewrite `src/utils/clientRouting.ts`: per-pair `POST /api/routing` with 2 stops; build matrix from real distances; drop Haversine and `distCache`.
- Simplify `src/app/api/optimize/route.ts`: drop `geoapifyMatrix`, `geoapifyTried`, `geoapifyCache`, Haversine fill, override loop.
- Delete `src/utils/geoapifyMatrix.ts`.
- Update `src/app/page.tsx` matrix phase: drop OSRM per-pair loops and `geoapifyTried`; use new `clientRouting.ts` API.
- Extend `routeLegKey` / `getCachedLeg` / `setCachedLeg` to cache distance + `source`.
- `src/utils/constants.ts`: remove `TINY_DISTANCE_KM` if unused.

### Out of Scope
Solver algorithms, UI redesign, new providers, `useStrictMatrix`, self-hosted OSRM.

## Capabilities

### New Capabilities
None

### Modified Capabilities
None — pure refactor. Unreachable-POI, strict-matrix, and route-source contracts stay bit-identical.

## Approach

1. For each pair (i,j) with `i < j`:
   - Check per-leg localStorage cache. Hit → reuse distance + `source`.
   - Miss → `POST /api/routing` with 2 stops. Response returns `distance` + `source` (`"geoapify" | "osrm" | "haversine"`).
   - `source === "haversine"` or empty → entry = `Infinity`. Cache sentinel to skip refetch.
2. Concurrency: 5 parallel calls (matches current OSRM workers).
3. Send complete `distances` map to `/api/optimize`. Backend passes through unchanged. `/api/routing` already returns per-leg `distance` — `legs[0].distance` for 2 stops is the pair distance. No backend contract change.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/utils/clientRouting.ts` | Rewrite | Per-pair `/api/routing`; cache distance + source; drop Haversine. |
| `src/app/api/optimize/route.ts` | Major cleanup | Remove Geoapify matrix branch, `geoapifyTried`, Haversine fill. |
| `src/utils/geoapifyMatrix.ts` | Deleted | No longer needed. |
| `src/app/api/routing/route.ts` | Verified | Already returns `distance` + `source` for 2 stops. |
| `src/app/page.tsx` | Moderate | Swap matrix call; drop OSRM loops and `geoapifyTried`. |
| `src/utils/constants.ts` | Minor | Remove `TINY_DISTANCE_KM` if unused. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Geoapify 3000 credits/day hit faster per-pair | Med | Per-leg cache; OSRM fallback free. |
| OSRM public server rate limits cause failures | Med | Per-leg cache absorbs repeats; pre-filter catches unreachable. |
| 2-stop routing may diverge from multi-stop geometry | Low | Geometry keeps full-day `/api/routing`; only matrix distances change. |
| `fetchAllRouteGeometries` cache-stitching fragility | Low | Public API preserved; same per-leg cache reused. |

## Rollback Plan

1. `git revert` the merge.
2. Re-add `geoapifyMatrix.ts` from git history.
3. Restore `distCache`, `osrmPair`, prior `buildDistanceMatrices` from prior commit.
4. No data migration — `localStorage` keys stay compatible.

## Dependencies

`GEOAPIFY_API_KEY` env var (existing). If absent, OSRM is sole provider; rate limits apply.

## Success Criteria

- [ ] `geoapifyMatrix.ts` deleted.
- [ ] `clientRouting.ts` has no OSRM direct call, no Haversine, no `distCache`.
- [ ] `api/optimize/route.ts` has no Geoapify matrix branch, no `geoapifyTried`, no Haversine fill.
- [ ] All-pairs matrix sent to backend contains ONLY real distances or `Infinity`.
- [ ] `tsc --noEmit` and `next lint` pass.
- [ ] Optimizer output bit-identical given the same matrix.
