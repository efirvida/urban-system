# Exploration: real-roads-only

> Stop treating Haversine (great-circle) distances as drivable. Every leg in every optimized route must come from a real-road provider, OR the POI must be rejected as unreachable.

## Current State

The VRP solver runs on a hybrid distance matrix that silently degrades to Haversine whenever a real-road provider fails. The matrix flows through the pipeline as a flat `Record<string, number>` keyed `"i,j"` (i<j, 0=home, 1..n=locations), with **no metadata** to distinguish real from estimated distances. Both downstream optimizers — `routerOptimizer` (deterministic + GA) and `nsga2` — trust this map and use it to compute tour fitness, NN neighbors, 2-opt swaps, GA crossover, and Pareto objectives.

Three distance providers exist: client-side OSRM (`clientRouting.ts`, the path actually used in production — see `src/app/page.tsx` flow), server-side Geoapify (`geoapifyMatrix.ts`), and a legacy `routing.ts` (single-pair OSRM, mostly dead code — `precomputeDistanceMatrix` is never called). There is also an unused `googleRouting.ts` (Google Routes API) that is not wired in.

**The single most dangerous silent failure is in `routerOptimizer.ts:matGet`** — when a matrix key is missing it returns `0` km, which is treated as a "free leg" by NN, 2-opt, local-search, and the GA. That is strictly worse than Haversine: it skews the search toward routes that include the missing-key POI by making it look arbitrarily close to every other point.

## Complete list of fallback points

### 1. `src/utils/clientRouting.ts` — production matrix builder (CLIENT SIDE)

**`buildDistanceMatrices` (lines 205-285)** — This is the matrix that is actually built in the browser and shipped to `/api/optimize`. Two silent Haversine fallbacks:

- **L259** — `if (H < 0.05) { osrmMatrix.set(key, H); haversineCount++; ... }`  
  Haversine for pairs < 50 m apart. This is a heuristic (Haversine ≈ real for very short distances) but it is still technically a fake distance that gets stored indistinguishable from real OSRM distances.

- **L272-275** — `osrmPair()` returned `null` OR threw → `osrmMatrix.set(key, H); haversineCount++`  
  Falls back to Haversine without flagging. This is the core bug: an OSRM `null` means "no road connection" and we silently substitute a straight-line distance.

**Detection scope:** Bounded to OSRM only. There is no provider fallback (no Geoapify) at the client level.

**Distinguishing real vs fake:** Compare `d` to `H` with `Math.abs(d - H) > 0.1` (L271). This means the code already knows which entries are real — it just throws the bit away.

### 2. `src/utils/geoapifyMatrix.ts` — server-side second pass

**`buildGeoapifyMatrix` (lines 137-263)** — Called server-side in `/api/optimize` to fill in pairs the client could not resolve. Silent Haversine fallback at:

- **L195-203** — `if (cell.distance !== null && ... >= 0) { matrix[key] = real } else { matrix[key] = haversineDistance(...) }`  
  Geoapify returns `null` (or negative) when no road exists between a pair → silently stored as Haversine.

- **L211-251** — "Second pass" retries failed pairs individually via 1×1 matrix calls. If the retry still returns `null`/throws (L237-242), the Haversine value from the first pass is kept. There is no "give up, this POI is unreachable" state.

**Distinguishing real vs fake:** `geoapifyMatrix` does not export which pairs it managed to resolve; the caller in `route.ts:87` infers "real" by re-comparing to the Haversine reference (`Math.abs(geoMatrix[key] - haversineRef[key]) > 0.01`). Pairs within that 0.01 km of Haversine are deemed "failed" and added to `geoapifyFailed`. So the codebase already encodes a real-vs-fake signal — it is just not propagated to the optimizer.

### 3. `src/utils/googleRouting.ts` — unused but live in repo

**`buildGoogleMatrix` (lines 27-133)** — Not wired to any caller, but has the same pattern:
- **L118-129** — After each batch, any pair that did not come back with `distanceMeters` gets filled with Haversine.

This is dead code on the current call path but is the third example of the same anti-pattern; touching it is in-scope for the refactor because the new type system must accommodate any provider.

### 4. `src/utils/routerOptimizer.ts` — the consumer of the matrix

**`matGet` (lines 10-20)** — THE BUG.
```ts
const val = matrix[key];
if (val === undefined) {
  console.warn(`[matGet] Missing key "${key}" (a=${a}, b=${b}), defaulting to 0`);
  return 0;
}
```
Returning `0` means "this leg is free." Every neighbor, every 2-opt swap, every local-search move, every GA fitness evaluation that hits a missing key underweights that leg to zero. Net effect: the optimizer *prefers* routes that touch the broken-key POI. The warning is silent in the UI.

**`reoptimizeDay` (lines 510-655)** — Edit-mode rebalancer. Hardcoded to Haversine for the entire day:
- **L541** — `const distance = (a, b) => haversineDistance(a.lat, a.lng, b.lat, b.lng);`  
  The `matrix` parameter is accepted but ignored (L505 comment: "unused — Haversine is faster for small day subsets"). Every edit-mode drag uses straight-line distances.

### 5. `src/utils/geneticOptimizer.ts` — post-optimizer

**`pd` (lines 16-34)** — Used in every GA fitness evaluation:
- **L22-27** — Try `pre[k]` first. If `undefined`, fall back to `haversineDistance(...)` based on raw lat/lng.  
  So the GA always has a usable number, but it has no way to know whether that number is real or estimated. A 5-POI route where 1 POI has only Haversine distances will be scored on mixed-quality data with no penalty.

### 6. `src/utils/nsga2.ts` — multi-objective

**`pd` (lines 65-75)** — Same pattern as GA:
- **L69** — `if (precomputed?.[k] !== undefined) return precomputed[k];` else Haversine.  
  NSGA2 iterates 80 pop × 100 gens × ~2 decodes/iter = 16k+ decodes. Each decode calls `pd` per leg. Every fake leg silently influences the Pareto front.

### 7. `src/app/api/optimize/route.ts` — server entry

**`buildHaversineMatrix` (lines 8-15)** — Used in three places:
- **L59** — when no frontend matrix is provided, every pair is Haversine. This is the "no OSRM at all" path.
- **L78** — used as the reference to detect which Geoapify pairs are real.
- **L109** — used to log the final source breakdown (Geoapify vs OSRM vs Haversine counts).

**`geoapifyFailed` (line 92)** — Keys where Geoapify came back equal-to-Haversine get added to this list. It is then returned in `_geoapifyTried` (line 183) so the frontend never re-tries them — the system already knows they are unreachable, but it does not act on that knowledge; it just ships Haversine to the optimizer.

### 8. `src/app/api/routing/route.ts` — geometry API

**`makeStraightLine` (lines 37-54)** — Last-resort geometry builder. Returns `source: "haversine"`. Called when both Geoapify and OSRM fail (L170-174). Used for map-display only (not optimization), so impact is limited to the visualization being a fake straight line for an unreachable POI.

## Impact trace

Data flow when a POI P has no road to home:
```
OSRM HTTP 200 / null distance (no road)
  └─→ clientRouting.ts:osrmPair returns null
       └─→ L272: osrmMatrix.set("0,P", haversineDistance(home, P))   // "fake" value stored
            └─→ Shipped as frontendMatrix["0,P"] = H_km              // indistinguishable
                 └─→ /api/optimize:matrix["0,P"] = H_km
                      ├─→ Geoapify: cell.distance === null
                      │    └─→ geoMatrix["0,P"] = haversineDistance(...)  // also fake
                      │         └─→ abs(geoMatrix - haversineRef) < 0.01
                      │              └─→ geoapifyFailed.push("0,P")       // we KNOW it's bad
                      │                   └─→ matrix["0,P"] stays at H_km  // still shipped
                      │
                      └─→ routerOptimizer:matGet("0,P")  →  H_km         // optimizer sees a real number
                           ├─→ buildGiantTour: nearest neighbor picks P first
                           ├─→ sliceTourToSolution: constraint check uses H_km
                           ├─→ localSearch: relocate/exchange moves P around freely
                           └─→ improveWithGA: pd("0,P")  →  H_km, scored honestly but mixed-quality
```

The optimizer **cannot** distinguish a 2 km Haversine leg from a 2 km OSRM leg. From its perspective the math is identical, so an unreachable POI gets the same routing priority as a conveniently-located one.

**Worse case — the `matGet` bug at routerOptimizer.ts:15-18:**

If the matrix is missing the key entirely (e.g. partial failure where the pair was never computed), `matGet` returns 0. This means:
- `tourDist` adds 0 for that leg → POI appears to be at the same location as its neighbor.
- `nearestNeighborWithinDay` picks that POI as "nearest" (any real distance > 0 loses to 0).
- 2-opt and local-search moves that touch the zero-leg pair look like massive improvements (d1+d2 >> 0+d2).
- GA fitness: any individual that includes the zero-leg POI in the right slot is artificially best.
- Result: the optimizer converges to including the broken-key POI in every day, day 1, first stop.

## Affected Areas

- `src/utils/clientRouting.ts` — needs to surface "no road" instead of substituting Haversine (L259, L272-275).
- `src/utils/geoapifyMatrix.ts` — needs to return a per-pair status, not a flat number map (L195-203, L237-242).
- `src/utils/googleRouting.ts` — needs to be aligned to the new contract (L118-129).
- `src/utils/routerOptimizer.ts` — `matGet` must return a discriminated result, not `0` (L10-20). `reoptimizeDay` must use the new contract (L510-655, L541).
- `src/utils/geneticOptimizer.ts` — `pd` must surface the per-leg source (L16-34).
- `src/utils/nsga2.ts` — `pd` must surface the per-leg source (L65-75).
- `src/app/api/optimize/route.ts` — must compute and ship `unreachable` per-location, not just per-pair (L92, L182-183).
- `src/app/page.tsx` — frontend must surface unreachable POIs in the UI; `reoptimizeDay` callers pass `undefined` today (L236-237) — that is a separate issue (Haversine-only edit mode) and is the easiest place to start a slice.
- `src/types/index.ts` — needs a `MatrixEntry` discriminated union and a `RoutingSource` enum.
- `src/app/api/routing/route.ts` — geometry API must flag when the source was `haversine` so the UI can show the user a "no road" segment (L32, L53).

## Approaches

### A. Discriminated `MatrixEntry` union, fail-closed on missing pairs

Change the matrix type from `Record<string, number>` to `Record<string, MatrixEntry>` where:
```ts
type MatrixEntry =
  | { source: "real"; km: number }
  | { source: "estimated"; km: number }   // only for in-flight optimistic UI
  | { source: "unreachable"; km: undefined };
```
- Pros: type system enforces the distinction; `matGet` cannot return `0` because the type forces the caller to narrow on `source`. Optimizer can be parameterized to either reject `unreachable` or score it with a heavy penalty.
- Cons: every call site (`pd`, `matGet`, `reoptimizeDay`, `routesToDays`, the API layer) needs to narrow. This is a mechanical but verbose refactor.
- Effort: **High** — touches 7 files and the public API contract.

### B. Parallel source map, keep `Record<string, number>` for the value

Keep the matrix as `Record<string, number>` and add a sibling `Record<string, "real" | "estimated" | "unreachable">` (already partially built as `sources` in `page.tsx:582` and `geoapifyCache` in `route.ts:67`).
- Pros: minimal disruption to the optimizer math; only the new rejection step reads the source map. Backwards-compatible with `precomputeDistanceMatrix` callers.
- Cons: the two maps can drift; the optimizer's `matGet` still has the `0` bug. There is no compile-time guarantee that the source map covers the value map.
- Effort: **Medium** — touches matrix builders and `matGet` only; the optimizer math stays intact.

### C. Pre-filter unreachable POIs before optimization; do not change the matrix type

Run a "can each POI reach home?" check before calling `optimizeRoutes`, and pass only the reachable subset. The matrix stays as-is. Unreachable POIs are returned in the response as `unassigned` and the user sees them in a separate list.
- Pros: zero risk to the optimizer; the change is local to the entry point and the response shape. Cleanest UX. Can be deployed behind a feature flag.
- Cons: still does not solve the `matGet:0` bug for partially-missing matrices; the optimizer still trusts its input.
- Effort: **Low** — touches the API route + frontend only.

### D. Hybrid: C for the optimization, B for `matGet` correctness

Do C first (rejection at the entry point), then B as a follow-up to make `matGet` safe against partial matrices.
- Pros: ships a user-visible win fast; de-risks the more invasive type refactor.
- Cons: two PRs to maintain alignment on.
- Effort: **Medium** total, but the first PR is small.

## Recommendation

**D — Hybrid, sliced for chained PRs.** The user-visible defect (unreachable POIs in "optimal" routes) is the priority. A pre-filter (C) is the highest-leverage fix because it does not require changing the optimizer contract and can be merged without touching `routerOptimizer`, `geneticOptimizer`, or `nsga2`. Once that lands, the `matGet:0` bug and the type-system refactor (B) become the next slice.

Within the same change, the `matGet:0` bug should be fixed as part of the pre-filter PR: the new entry-point code is the natural place to assert that every (a,b) pair the optimizer will need exists in the matrix. This is a one-line fix that prevents the worst case in B.

## Suggested slice boundaries (stacked-to-main chained PRs)

### PR 1 — `feat: pre-filter unreachable POIs before optimization` (slice: pre-filter)

- **Scope:** `src/app/api/optimize/route.ts` only.
- **Logic:** After building the matrix (frontend + Geoapify), classify each POI as `reachable` if at least one real-road leg (home→P) exists, else `unreachable`. Reject unreachable POIs from `locations` before calling `optimizeRoutes` / `runNSGA2`. Return a new `unreachable: Location[]` field in the response.
- **Out of scope:** matrix type changes, `matGet` fix, optimizer changes.
- **Risk:** Low. Optimizer never sees unreachable POIs, so all downstream behavior is unchanged. Backwards-compatible response (new field is optional).
- **Files:** 1 (`src/app/api/optimize/route.ts`).
- **Size:** ~50 lines.

### PR 2 — `fix: matGet returns Infinity for missing keys instead of 0` (slice: matGet safety)

- **Scope:** `src/utils/routerOptimizer.ts` only (L10-20).
- **Logic:** Return `Number.POSITIVE_INFINITY` (or `1e9`) when the key is missing instead of `0`. Add an integration test in the slice where a partial matrix is passed and verify the optimizer never picks the broken-key POI in the first slot.
- **Out of scope:** matrix type, any call site of `matGet`.
- **Risk:** Low. The new value is a giant number; 2-opt/GA will only pick the broken-key POI when every other choice is worse, which is the right behavior. The pre-filter from PR 1 means the user never sees this case in production, but the fix is cheap insurance.
- **Files:** 1.
- **Size:** ~10 lines.

### PR 3 — `feat: discriminated matrix type with per-leg source` (slice: type system)

- **Scope:** New type in `src/types/index.ts`; refactor all 4 matrix builders (`clientRouting`, `geoapifyMatrix`, `googleRouting`, and the inline `buildHaversineMatrix` in `route.ts`) to return the new shape. Optimizers consume it.
- **Logic:**
  - `type MatrixEntry = { source: "real" | "estimated" | "unreachable"; km?: number }`
  - `type Matrix = Record<string, MatrixEntry>`
  - New helper `matGet(a, b, m): MatrixEntry` in each optimizer
  - `pd` in `geneticOptimizer` and `nsga2` returns the entry; callers narrow.
  - Infeasible legs (unreachable) are scored with `Infinity` in the objective.
- **Out of scope:** none — this is the "complete the type system" slice.
- **Risk:** Medium. Touches every consumer; needs careful migration to avoid breaking the GA's `pd` / NSGA2's `pd` numeric comparisons. Recommend landing behind a feature flag (`useStrictMatrix`) and shipping both code paths for one release.
- **Files:** 7 (all matrix builders + 3 optimizers + types).
- **Size:** ~300 lines including tests.

### PR 4 — `feat: frontend surfaces unreachable POIs in the results panel` (slice: UX)

- **Scope:** `src/app/page.tsx`, `src/components/ResultsPanel.tsx` (or new component).
- **Logic:** Read `apiData.unreachable` (added in PR 1) and render a "No road connection" badge / section with the list of excluded POIs + the reason. Offer a "Try again" button that re-queries Geoapify for the failed keys.
- **Out of scope:** matrix, optimizer.
- **Risk:** Low. Pure UI.
- **Files:** 2-3.
- **Size:** ~150 lines.

### PR 5 — `fix: reoptimizeDay uses the real matrix` (slice: edit mode)

- **Scope:** `src/utils/routerOptimizer.ts:reoptimizeDay` and its callers in `src/app/page.tsx:236-237`.
- **Logic:** Wire the matrix through. If a day has an unreachable POI, mark the day as un-editable until the user removes it. Otherwise use the new `MatrixEntry` for ordering.
- **Out of scope:** none.
- **Risk:** Low. Edit mode is already isolated.
- **Files:** 2-3.
- **Size:** ~80 lines.

### PR 6 — `feat: geometry API flags Haversine fallback segments` (slice: map visualization)

- **Scope:** `src/app/api/routing/route.ts` + `src/components/MapView.tsx`.
- **Logic:** When `source: "haversine"` is the only path, mark the polyline with a dashed style and a tooltip "No road found — straight line shown." Per-leg flag if any.
- **Out of scope:** optimizer.
- **Risk:** Low. Display only.
- **Files:** 2.
- **Size:** ~100 lines.

**Stacking order:** PR 1 → PR 4 (depends on the new response field) → PR 2 (independent, can be ordered earlier) → PR 5 (independent) → PR 6 (independent) → PR 3 (the type refactor, last because it touches everything).

PR 3 is intentionally last because it is the only one that touches the optimizer contract. Until that lands, the system can rely on PR 1 to keep unreachable POIs out of optimization, and on PR 2 to keep the optimizer from being poisoned by a partial matrix.

## Risks and edge cases

- **Geoapify free tier (3k credits/day) may exhaust.** PR 1's "reachable?" check could amplify calls. Mitigation: use the `geoapifyTried` cache (already in place) and limit retries to ≤ 100 (already in place at L225).
- **A POI that has a real road to one neighbor but not to home.** Current code marks it reachable if any real road exists. Optimizer may still place it on a route that has to cross the unreachable leg. Mitigation: the constraint check in `dayViolates` will catch it only if the leg is `Infinity`; the new type system in PR 3 is what makes that checkable.
- **OSRM rate-limits (1 req/s) on the public server.** `clientRouting.ts` already does 5 concurrent workers and per-pair cache. No regression expected from this change.
- **Frontend sends `geoapifyTried` so we do not re-call Geoapify for already-tried keys.** PR 1 must preserve that loop: unreachable POIs discovered this round should also flow into `geoapifyTried` for the next session.
- **Edit mode `reoptimizeDay` is called with `undefined` matrix in `page.tsx:236-237`.** This is currently masked by the Haversine fallback inside `reoptimizeDay`. PR 5 needs to either propagate `undefined` correctly or require a matrix.
- **The `0.1` / `0.01` km thresholds for "is this real?" differ across files** (`routing.ts:176`, `clientRouting.ts:263`, `geoapifyMatrix.ts:219`, `route.ts:87`, `route.ts:113`). Centralize the constant in `types/index.ts` or a `routingConstants.ts` file as part of PR 3.
- **NSGA2 runs in the same scope with 30s timeout** (route.ts:140). Adding a pre-filter step adds negligible time; no risk of timeout regression.
- **A single unreachable POI in a small input (3 POIs) is the worst UX** — the user gets 2 POIs routed and 1 in a "not reachable" box. Make sure the UI copy explains why and offers a remedy (manual override? switch provider?).
- **`routerOptimizer` re-uses `precomputedMatrix` for `osrmPairs` count** (L99). When the matrix is built by PR 3's new contract, this count needs to be redefined as "real pairs" not "matrix entries."
