# Archive: Route Calculation Refactor

**Change**: `route-calculation-refactor`
**Archived**: 2026-06-18
**Archive path**: `openspec/changes/archive/2026-06-18-route-calculation-refactor/`
**Mode**: openspec

## Intent (from proposal)

Collapse two parallel routing stacks — frontend OSRM per-pair (`clientRouting.ts`) and backend Geoapify Route Matrix override (`geoapifyMatrix.ts`) — into a single **Strategy Pattern** plugin system. A `RoutingService` orchestrates pluggable `RouteProvider` implementations tried in priority order (Geoapify → OSRM) per pair. No Haversine fallback; unreachable pairs get `Infinity`. Backend `/api/optimize` receives the completed frontend matrix and passes it through unchanged.

This is a **pure refactor** — no new capabilities, no modified capabilities from the user perspective. Unreachable-POI, strict-matrix, and route-source contracts stay bit-identical.

## Final Architecture

### Provider plugin model (Strategy Pattern)

```
RoutingService (chain-of-responsibility, sorted by priority)
  ├─ GeoapifyProvider (priority 0)  → POST /api/routing {stops:[a,b]} → server-side Geoapify
  └─ OSRMProvider    (priority 1)  → GET router.project-osrm.org/route/v1/driving/...
                                     ↳ null on any failure → next provider → Infinity if all fail
```

### Data flow

```
page.tsx optimize()
  └─> RoutingService.buildDistanceMatrix(points)
        └─ for each pair (i,j):
             ├─ cache.get(key) → hit → cached distance
             └─ miss → service.route(a, b) [chain through providers]
                  └─ cache.set(key, result)

/api/optimize  ←  { locations, config, distanceMatrix: Record<string,number> }
  (no Geoapify override — passes matrix to optimizer unchanged)
```

### Key contracts

```typescript
interface RouteProvider {
  readonly name: string;
  readonly priority: number;       // lower = tried first
  route(a: Point, b: Point): Promise<RouteLegResult | null>;
}

interface RouteLegResult {
  distanceKm: number;
  durationSeconds: number;
  geometry: [number, number][];
  source: string;                  // provider name (e.g. "geoapify")
}

interface CachedLeg extends RouteLegResult {
  timestamp: number;               // for TTL / LRU eviction
}
```

**Provider contract**: `route()` returns `null` when the provider cannot find a real road. Never throws — errors are caught internally. `RoutingService` tries the next provider; if all return `null`, the pair is `Infinity`.

## File Changes

### Created (6 files)

| File | Lines | Purpose |
|------|-------|---------|
| `src/utils/routing/types.ts` | 59 | `RouteProvider` interface, `RouteLegResult`, `CachedLeg`, `Point` |
| `src/utils/routing/cache.ts` | 136 | `getCachedLeg()` / `setCachedLeg()` / key builder; LRU cap 5000; per-leg localStorage with `{distance, geometry, source, timestamp}` |
| `src/utils/routing/service.ts` | 161 | `RoutingService` — holds sorted providers, `route(a,b)` chain, `buildDistanceMatrix(points)` |
| `src/utils/routing/providers/osrm.ts` | 61 | `OSRMProvider` (priority 1) calling `router.project-osrm.org` with 5s timeout; `null` on error |
| `src/utils/routing/providers/geoapify.ts` | 53 | `GeoapifyProvider` (priority 0); `POST /api/routing` with 2 stops; returns iff `source === "geoapify"` |
| `src/utils/routing/providers/index.ts` | 20 | Exports `defaultProviders: RouteProvider[]` ordered `[Geoapify(0), OSRM(1)]` |

### Modified (4 files)

| File | Change | Notes |
|------|--------|-------|
| `src/utils/clientRouting.ts` | Rewrite (299 lines, was 414+) | `buildDistanceMatrices()` delegates to `RoutingService`; `fetchAllRouteGeometries()` reads from routing cache; dropped `distCache` Map, `osrmPair()`, local `RouteSource` type, inline Haversine fallback. Public API preserved. |
| `src/app/page.tsx` | Simplified (283 lines changed) | Replaced inline OSRM matrix loops with `RoutingService.buildDistanceMatrix()`; removed `geoapifyTried` state, Geoapify merge block, `apiPayload.geoapifyTried` field; `loadCachedMatrix`/`saveCachedMatrix` cache only `{distances, home}` |
| `src/app/api/optimize/route.ts` | Simplified (99 lines removed) | Dropped `geoapifyMatrix` import, `buildGeoapifyMatrix()` call, `geoapifyCache`, `geoapifyTried` body field, `buildDistanceMatrix()` helper; `useStrictMatrix` flag and `DistanceMatrix`/`MatrixEntry` types kept for optimizer compatibility |
| `src/utils/routing/types.ts` | Created (not modified — listed for completeness) | See Created above |

### Deleted (1 file)

| File | Reason |
|------|--------|
| `src/utils/geoapifyMatrix.ts` | Replaced by `providers/geoapify.ts` (which routes through the existing backend `/api/routing` proxy); per-pair approach replaces the deprecated batch-matrix approach |

### Touched (metadata)

- `.eslintrc.json` — added (required for `next lint` to run on the new `routing/` directory)

## Key Metrics

| Metric | Value |
|--------|-------|
| Total changed lines (additions + deletions, refactor commits only) | 1,042 (296 added, 746 removed) — **net deletion of 450 lines** |
| Files created | 6 |
| Files modified | 4 (excluding `tasks.md` metadata churn) |
| Files deleted | 1 |
| PRs | 3 (chained PR workflow) |
| Delivery strategy | size:exception (chained PRs recommended; 400-line budget risk was High) |
| `geoapifyMatrix.ts` lines removed | 210 |
| `route.ts` (backend) lines removed | 86 |
| `page.tsx` (frontend) lines removed | 215 |

### PR breakdown

| PR | Commit | Goal | Notes |
|----|--------|------|-------|
| 1 | `c3b9a31` | Provider infrastructure | New code only — types/cache/providers/service (~296 lines added net) |
| 2 | `7a7d3be` | clientRouting + frontend wiring | Rewrite `clientRouting.ts`, simplify `page.tsx` matrix phase |
| 3 | `2cebef0` | Backend cleanup + verification | Drop `geoapifyMatrix` import, delete file, lint/typecheck |

## Verification Results

> **Note**: The formal `verify-report.md` artifact is **not present** in this change folder. The orchestrator's launch context provided the verification summary inline (see follow-up items below). Per the strict-vs-OpenSpec archive policy, this archive proceeds as **intentional-with-warnings** — the missing verify report is recorded here.

### Quality gates

- **TypeScript**: `tsc --noEmit` — passes
- **Lint**: `next lint` — passes with **3 pre-existing warnings** (not introduced by this refactor)
  - `src/app/page.tsx:633`
  - `src/app/page.tsx:674`
  - `src/components/MapView.tsx:126`
- **Build**: `next build` — passes

### Behavior parity

- Matrix contains ONLY real distances or `Infinity` (Haversine fallback removed)
- Optimizer output bit-identical to pre-refactor
- `useStrictMatrix` flag and `DistanceMatrix`/`MatrixEntry` types preserved for backward compatibility

## Known Limitations & Follow-up Items

### Intentional design choices (not bugs)

1. **`haversineKm` retained in `clientRouting.ts`**
   - **Status**: intentional
   - **Reason**: Used solely as a polyline-length estimator when computing map line metrics — NOT a routing fallback. Removing it would break `formatDistance()` and polyline rendering length calculations. The routing matrix no longer uses Haversine at all.

### Cleanup items (post-archive)

2. **Stale comment in `src/utils/constants.ts:10`**
   - **Status**: cleanup needed
   - **Issue**: Comment references `geoapifyMatrix.ts:219` — file was deleted in this refactor
   - **Suggested fix**: Edit `constants.ts` to drop the "Previously scattered as magic literals" block which now lists a non-existent file, or update it to reference `providers/geoapify.ts` and `service.ts` instead
   - **Priority**: low (cosmetic; doesn't affect runtime)

3. **3 pre-existing lint warnings (not introduced by this refactor)**
   - **Status**: pre-existing
   - **Locations**:
     - `src/app/page.tsx:633`
     - `src/app/page.tsx:674`
     - `src/components/MapView.tsx:126`
   - **Suggested fix**: Address in a dedicated cleanup change (`route-editor-redesign` follow-up or new `lint-cleanup` change)
   - **Priority**: low

### Open question (from design, unanswered)

- Should the cache layer migrate to IndexedDB for matrices > 1000 pairs? Current localStorage cap is 5000 entries (~1MB worst-case at 200 bytes/entry). At 50 POIs + home (1275 pairs), usage is well within limits. **Decision**: defer until real-world usage exceeds the 1000-pair threshold.

## Archive Contents

- `proposal.md` ✅
- `design.md` ✅
- `tasks.md` ✅ (19/19 tasks complete, all marked `[x]`)
- `archive.md` ✅ (this file)

## Source of Truth Updated

**No main specs were modified.** This change has no `specs/` subdirectory and no `openspec/specs/{domain}/spec.md` files were touched — confirmed pure refactor with no spec-level changes. The `openspec/specs/` directory contents (`route-editing`, `routing-source-tracking`, `strict-matrix-contract`, `unreachable-poi-handling`) remain bit-identical to pre-refactor.

## SDD Cycle Status

| Phase | Status |
|-------|--------|
| Explore | not run (skipped — refactor scope was clear) |
| Propose | ✅ done — `proposal.md` |
| Spec | not run — no spec changes needed (pure refactor) |
| Design | ✅ done — `design.md` |
| Tasks | ✅ done — `tasks.md` (19/19) |
| Apply | ✅ done — 3 chained PRs merged |
| Verify | ⚠️ done (inline; no formal `verify-report.md` artifact) |
| Archive | ✅ done — this file |

**Cycle complete.** Ready for the next change.
