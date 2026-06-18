# Proposal: Route Calculation Refactor

## Intent

Two parallel routing stacks: frontend OSRM per-pair (`clientRouting.ts`) and backend Geoapify Route Matrix override (`geoapifyMatrix.ts`). The backend replaces OSRM distances in the matrix but never the UI, so display and optimizer totals disagree. Collapse both into one path: per-pair `POST /api/routing` (Geoapify → OSRM) with per-leg localStorage cache. No Haversine fallback, no Geoapify matrix API.

## Scope

### In Scope
- Rewrite `src/utils/clientRouting.ts`: per-pair `POST /api/routing` with 2 stops; build matrix from real distances; drop Haversine and `distCache`.
- Simplify `src/app/api/optimize/route.ts`: drop `geoapifyMatrix`, `geoapifyTried`, `geoapifyCache`, Haversine fill, override loop.
- Delete `src/utils/geoapifyMatrix.ts`; update `src/app/page.tsx` matrix phase accordingly.
- Extend `routeLegKey` / `getCachedLeg` / `setCachedLeg` to also cache distance + `source`.
- `src/utils/constants.ts`: remove `TINY_DISTANCE_KM` if unused.

### Out of Scope
Solver algorithms, UI redesign, new providers, `useStrictMatrix`, self-hosted OSRM.

## Capabilities

### New Capabilities
None

### Modified Capabilities
None — pure refactor. Unreachable-POI, strict-matrix, and route-source contracts stay bit-identical from the user perspective.

## Approach

For each pair (i,j) with `i < j`: hit per-leg cache → reuse; miss → `POST /api/routing` with 2 stops (response gives `distance` + `source`); `source === "haversine"` or empty → entry = `Infinity`, cache sentinel to skip refetch. 5 parallel calls. Frontend sends complete `distances` to `/api/optimize`; backend passes through unchanged. `/api/routing` already returns per-leg `distance` — no backend contract change.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/utils/clientRouting.ts` | Rewrite | Per-pair `/api/routing`; cache distance + source; drop Haversine. |
| `src/app/api/optimize/route.ts` + `page.tsx` | Major cleanup | Remove Geoapify matrix branch, `geoapifyTried`, Haversine fill, OSRM per-pair loops. |
| `src/utils/geoapifyMatrix.ts` | Deleted | No longer needed. |
| `src/app/api/routing/route.ts`, `src/utils/constants.ts` | Verified / Minor | Already returns `distance`+`source`; remove `TINY_DISTANCE_KM` if unused. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Geoapify credit burn or OSRM rate limits per-pair | Med | Per-leg cache; OSRM free fallback. |
| 2-stop routing diverges from multi-stop geometry | Low | Geometry keeps full-day `/api/routing`; only matrix distances change. |
| `fetchAllRouteGeometries` cache-stitching fragility | Low | Public API preserved; same per-leg cache reused. |

## Rollback Plan

1. `git revert` the merge; re-add `geoapifyMatrix.ts` from history.
2. Restore `distCache`, `osrmPair`, prior `buildDistanceMatrices` from prior commit.
3. No data migration — `localStorage` keys stay compatible.

## Dependencies

`GEOAPIFY_API_KEY` env var (existing). If absent, OSRM is sole provider.

## Success Criteria

- [ ] `geoapifyMatrix.ts` deleted; `clientRouting.ts` has no OSRM direct call, no Haversine, no `distCache`.
- [ ] `api/optimize/route.ts` has no Geoapify matrix branch, no `geoapifyTried`, no Haversine fill.
- [ ] Matrix contains ONLY real distances or `Infinity`; `tsc --noEmit` and `next lint` pass; optimizer bit-identical.
