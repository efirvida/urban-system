# Design: Real Roads Only

## Technical Approach

Pre-filter unreachable POIs at the API entry point (PR 1), harden `matGet` to return `Infinity` (PR 2), add UI badges (PR 3), fix `reoptimizeDay` (PR 4), visualize estimated legs on the map (PR 5), then introduce a discriminated `MatrixEntry` type gated by `useStrictMatrix` (PR 6). Each PR is a stacked-to-main slice: PRs 1,2,5 are independent; PR 3 depends on PR 1; PR 4 depends on PR 1; PR 6 depends on all others.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Pre-filter in API vs optimizer | API keeps optimizer math clean; optimizer sees only reachable POIs | Pre-filter at API entry (`route.ts`) |
| `matGet` → `Infinity` vs throw | Infinity propagates naturally through `totalDist` without try/catch at every `pd` call | Return `Infinity` |
| Feature flag vs big-bang type migration | Flag lets PR 6 ship both paths, rollback = toggle off | `useStrictMatrix` boolean flag |
| Home→P gate only vs full reachability in PR 1 | Faster ship; false positives tolerable (POI reachable to neighbor but not home) | Home→P gate only; intra-day deferred to PR 6 |

## Constants

Centralize thresholds in a new file to eliminate scattered magic numbers:

- `REAL_VS_ESTIMATED_KM = 0.1` — threshold distinguishing real road from Haversine
- `TINY_DISTANCE_KM = 0.05` — pairs <50m use Haversine (road network not meaningful)

Current scatter: `clientRouting.ts:263` uses `0.1`; `geoapifyMatrix.ts:219` uses `0.01`; `route.ts:87` uses `0.1`, line 113 uses `0.01`. All replaced with the constant.

## Data Flow (PR 1: Pre-filter)

```
POST /api/optimize
  │
  ├─ buildHaversineMatrix(all)       → haversineRef
  ├─ build frontend/osrm/geo matrix  → matrix (Record<string,number>)
  │
  ├─ FOR each POI i (1..n):
  │    key = "0,{i}"
  │    IF matrix[key] undefined OR |matrix[key] - haversineRef[key]| < REAL_VS_ESTIMATED_KM
  │      → push to unreachable[]
  │    ELSE → push to reachable[]
  │
  ├─ optimizeRoutes(reachable, config, matrix)   → days, totalDistance
  │
  └─ Response: { days, totalDistance, unreachable: Location[], _meta }
```

## File Changes

| File | PR | Action | Description |
|------|-----|--------|-------------|
| `src/utils/constants.ts` | 1 | Create | `REAL_VS_ESTIMATED_KM`, `TINY_DISTANCE_KM` |
| `src/app/api/optimize/route.ts` | 1 | Modify | Pre-filter logic; `unreachable` field; import constants |
| `src/types/index.ts` | 1,6 | Modify | `unreachable?: Location[]` in response (PR 1); `MatrixEntry`, `RoutingSource`, `StrictMatrix` (PR 6) |
| `src/utils/routerOptimizer.ts` | 2,4 | Modify | `matGet` → Infinity (PR 2); `reoptimizeDay` uses matrix + signals Haversine (PR 4) |
| `src/utils/geneticOptimizer.ts` | 2,6 | Modify | `pd` no Haversine fallback when pre[K] missing (PR 2); `StrictMatrix` migration (PR 6) |
| `src/utils/nsga2.ts` | 2,6 | Modify | `pd` no Haversine fallback when pre[K] missing (PR 2); `StrictMatrix` migration (PR 6) |
| `src/utils/clientRouting.ts` | 6 | Modify | Return tagged `MatrixEntry` instead of bare number |
| `src/utils/geoapifyMatrix.ts` | 6 | Modify | Return `StrictMatrix`; per-pair source tagging |
| `src/utils/routing.ts` | 6 | Modify | `isRealDistance` → `classifyPair` returning `RoutingSource` |
| `src/app/api/routing/route.ts` | 5 | Modify | Per-leg `source` in `RouteLeg` |
| `src/app/page.tsx` | 3,4 | Modify | Unreachable badge + "Try again" CTA (PR 3); day lock on unreachable POIs (PR 4) |
| `src/components/ResultsPanel.tsx` | 3 | Modify | Render `unreachable` section |
| `src/components/MapView.tsx` | 5 | Modify | Dashed polyline for `estimated` legs |
| `src/utils/googleRouting.ts` | 6 | Modify | Type migration (dead code, compile-only) |

## Interfaces / Contracts

### PR 1: New API response field

```typescript
// OptimizeResponse gains:
unreachable?: Location[];  // POIs excluded from optimization
```

### PR 4: reoptimizeDay distance resolution

```typescript
// Internal helper to resolve location pairs through the index-based matrix:
function resolveDistance(
  a: Location, b: Location,
  locIndexMap: Map<string, number>,
  matrix: Record<string, number>
): number | null {
  const ia = locIndexMap.get(`${a.lat.toFixed(5)},${a.lng.toFixed(5)}`);
  const ib = locIndexMap.get(`${b.lat.toFixed(5)},${b.lng.toFixed(5)}`);
  if (ia === undefined || ib === undefined) return null;
  const k = ia < ib ? `${ia},${ib}` : `${ib},${ia}`;
  return matrix[k] ?? null;
}
```

### PR 6: Discriminated MatrixEntry

```typescript
type RoutingSource = "real" | "estimated" | "unreachable";

type MatrixEntry =
  | { source: "real"; distance: number; provider: "osrm" | "geoapify" }
  | { source: "estimated"; distance: number; reason: "haversine" | "tiny" }
  | { source: "unreachable" };

type StrictMatrix = Record<string, MatrixEntry>;
```

`useStrictMatrix` at API level switches the matrix builder output. Consumers read `matrix[key].source` to decide behavior. When `false`, legacy `Record<string, number>` — zero-downtime revert.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `matGet` returns Infinity for missing key | Pure function test (no test framework yet — manual via `tsc --noEmit` type check + console.assert in dev) |
| Unit | Pre-filter classification: real vs haversine vs unreachable | Extract pre-filter logic into a pure function `filterUnreachable(locations, home, matrix, haversineRef, threshold)` |
| Unit | `pd` in GA/NSGA2 rejects candidate on Infinity | Verify `totalDist` returns Infinity when any key is missing |
| Integration | API returns `unreachable: []` when all POIs have real roads | Manual HTTP test with known-good coordinates |
| Integration | API returns `days: []` when all POIs are unreachable | HTTP test with isolated coordinates (200 OK) |
| E2E | Map shows dashed polyline for Haversine-only leg | Visual inspection in browser |
| E2E | Day locked when it contains unreachable POI | Edit mode: drag handles disabled |

## Migration / Rollout

Feature-flagged via `useStrictMatrix: boolean` (default `false`) in PR 6. Flag controls whether the API and all consumers use `StrictMatrix` or legacy `Record<string, number>`. Each PR 1-5 is independently revertible (see proposal §Rollback Plan). No data migration — the matrix is recomputed on every request.

## Open Questions

- [ ] Should `findLocationIndex` use name-matching or coordinate epsilon for `reoptimizeDay` matrix lookup? Coordinate epsilon (1e-5) recommended to handle floating point drift.
- [ ] Should the `useStrictMatrix` flag be per-request or server-level env var? Per-request (passed in body) allows A/B testing; server env var is simpler.
