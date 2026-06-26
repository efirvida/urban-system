# Exploration: system-improvements

> Map the current state of 10 system-quality improvement areas in the VRP solver so a follow-up change can scope the work concretely.

## TL;DR — Quick verdict per area

| # | Area | Status | Action needed |
|---|------|--------|--------------|
| 1 | Pre-filter unreachable POIs | **LIVE & working** | Bug to fix: API does not surface POI rejection to UI when matrix has no `0,i` key (see Finding 1.2) |
| 2 | `useStrictMatrix` flag | **WIRED end-to-end** | None — feature works as designed, default off |
| 3 | `matGet` returning 0 for missing keys | **FIXED** | None — now returns `Infinity` with `console.warn` |
| 4 | `page.tsx` size & structure | **1364 lines, all inline** | Refactor candidate — extract hooks/handlers |
| 5 | Testing | **NONE** | Add vitest + a couple of smoke tests |
| 6 | Prettier | **NOT installed** | Add `.prettierrc` + `prettier` to devDeps |
| 7 | Error handling | **Mostly `console.error` + 6s toast** | One `window.alert` in `routeExport.ts:886` |
| 8 | Geoapify credit / source feedback | **Partially** — telemetry exists but never reaches UI | Add `_meta` source breakdown + UI badge |
| 9 | Server-side i18n | **N/A — export is client-side** | None (but add locale param documentation) |
| 10 | OSRM public API usage | **Direct browser call, 5s timeout, 5 concurrent** | Acceptable; minor: add backoff |

---

## 1. Pre-filter unreachable POIs

### 1.1 Current state — WIRED

- **Filter implementation** lives at `src/utils/unreachableFilter.ts:15-55`. Accepts both `Record<string, number>` and `DistanceMatrix`. Detects "strict" mode via `Object.values(matrix).some(v => typeof v === "object" && "source" in v)`.
- **Wired into the API** at `src/app/api/optimize/route.ts:91-94` (called unconditionally — always filters, regardless of `useStrictMatrix`):
  ```ts
  let { reachable, unreachable } =
    useStrictMatrix && strictMatrix
      ? filterUnreachable(locations, home, strictMatrix)
      : filterUnreachable(locations, home, matrix);
  ```
- **Returned in response** at `src/app/api/optimize/route.ts:179, 250` — `unreachable: unreachableForResponse` and `_meta.unreachableCount`.
- **UI component** at `src/components/UnreachableWarning.tsx:23-84` — renders an amber card with retry CTA.
- **Type** at `src/types/index.ts:179-192` — `UnreachablePoi { name, lat, lng, reason: "no_road_connection" | string }`.

### 1.2 Edge-case bug — POI absent from matrix is NOT marked unreachable

The filter (`unreachableFilter.ts:43-50`) marks a POI unreachable when `m[key] === undefined || !Number.isFinite(m[key])`. **But the underlying matrix in the legacy path is the frontend's `Record<string, number>`** — if the client-side `buildDistanceMatrices` never produced a `0,i` key (e.g. network failure left a hole), the POI is silently treated as unreachable only because the key is missing. The legacy `clientRouting.ts:buildDistanceMatrices` (`src/utils/clientRouting.ts:142-160`) returns a `Map<string, number>` filled from the routing service. If the routing service silently drops a pair (no provider returned a value), the key is absent, the filter rejects the POI, and `unreachable` correctly catches it.

**However**: in the consensus path (`src/app/api/optimize/route.ts:96-176`), the pre-filter runs **first** (line 91-94, before `useConsensus`), then consensus re-filters and remaps. If the frontend's matrix was empty (consensus mode) but the pre-filter saw the empty matrix, **every POI** is marked unreachable. This is "correct" but surprising — currently masked by the frontend passing an empty `distances: {}` only in consensus mode (`page.tsx:506`).

### 1.3 Verdict

The feature is **live and functionally correct**. Bug to investigate: ensure the `0,i` keys are always present before calling `filterUnreachable` (the pre-filter assumes they exist; in the legacy client-built matrix, missing keys → unreachable, which is the documented contract).

---

## 2. `useStrictMatrix` flag

### 2.1 Current state — FULLY WIRED

| Stage | File:Line | Behavior |
|---|---|---|
| Type definition | `src/types/index.ts:103-110` | `Config.useStrictMatrix?: boolean` — optional, default `false` |
| Frontend default | `src/app/page.tsx:181-188` | Not set in initial state — stays `undefined` → coerced to `false` |
| Frontend sends | `src/app/page.tsx:565` | `useStrictMatrix: config?.useStrictMatrix ?? false` |
| API reads | `src/app/api/optimize/route.ts:48-51` | Coerces top-level → `config.useStrictMatrix` → `false` |
| API uses | `src/app/api/optimize/route.ts:77-86` | Builds `strictMatrix: DistanceMatrix` from frontend matrix |
| API uses | `src/app/api/optimize/route.ts:91-94` | Passes `strictMatrix` to `filterUnreachable` (strict path) |
| API uses | `src/app/api/optimize/route.ts:189` | Passes to `registry.runAll({ strictMatrix })` |
| API echoes | `src/app/api/optimize/route.ts:251, 257` | Returns `strictMatrix` and `_meta.useStrictMatrix` |

### 2.2 Verdict

The flag works end-to-end. **Bit-identical to pre-PR-6 when `false`** (verified by reading both paths in `matGet` at `src/utils/routerOptimizer.ts:14-41`). No outstanding work for this area.

---

## 3. `matGet` returning 0 for missing keys

### 3.1 Current state — FIXED

`src/utils/routerOptimizer.ts:14-41`:

```ts
function matGet(a, b, matrix, strictMatrix?): number {
  const ka = a === -1 ? 0 : a + 1;
  const kb = b === -1 ? 0 : b + 1;
  const key = ka < kb ? `${ka},${kb}` : `${kb},${ka}`;

  // Strict path (PR 6) — prefer the per-pair entry when supplied.
  if (strictMatrix) {
    const entry = strictMatrix[key];
    if (entry === undefined) {
      console.warn(`[matGet] Missing strict key "${key}" (a=${a}, b=${b}), returning Infinity`);
      return Infinity;
    }
    return entry.distance;
  }

  // Legacy path — Record<string, number>. Behavior unchanged.
  const val = matrix?.[key];
  if (val === undefined) {
    console.warn(`[matGet] Missing key "${key}" (a=${a}, b=${b}), returning Infinity`);
    return Infinity;
  }
  return val;
}
```

**Both paths return `Infinity`, not `0`.** The previous bug (silent `0` fallback) is closed. `Infinity` correctly poisons the candidate route in NN, 2-opt, local-search, and GA — opt-in matGet callers that try to add an unreachable POI get an `Infinity` leg, which the route builders reject (NN/2-opt skip candidates that would exceed the constraint).

### 3.2 Verdict

Fixed. No outstanding work.

---

## 4. `page.tsx` size & structure

### 4.1 Metrics

- **File size**: 1364 lines (`wc -l`).
- **React hooks in `Home()` component**: 30 `useState` + 3 `useEffect` + ~16 `useCallback` + 4 `useMemo` + 1 `useRef`.
- **Module-level functions**: 3 (`locationsHash`, `loadCachedMatrix`, `saveCachedMatrix` — localStorage cache).
- **Custom hooks extracted**: **0**.
- **External state management**: **None** (no Zustand, Redux, Jotai, Context, etc.).

### 4.2 Component breakdown

| Lines | Responsibility |
|---|---|
| 1-45 | Imports + i18n + matrix cache types |
| 47-126 | Module-level matrix cache (load/save + hash) |
| 128-150 | Dynamic imports of components |
| 155-170 | Phase definition |
| 159-433 | Component setup, state declarations, memos, `mapData` builder |
| 432-437 | Dead code: `fetchGeometryForVisible` is a no-op stub |
| 440-473 | File/mapping/review handlers |
| 475-762 | `handleOptimize` — 287 lines, the biggest function |
| 763-809 | Place/drag home + refetch geometries + error auto-dismiss |
| 812-895 | Apply / discard / toggle edit / reset |
| 894-940 | Algorithm change + winner memos |
| 942-end | JSX render |

### 4.3 Data flow inside `page.tsx`

```
FileUpload → rawData → ColumnMapper → validatedRows → DataEditor
   → locations → ConfigPanel → config → OptimizeButton
   → handleOptimize
     ├─ loadCachedMatrix (line 513)
     ├─ buildDistanceMatrices (line 525)         [legacy path]
     ├─ saveCachedMatrix (line 537)
     ├─ POST /api/optimize (line 573)
     │   body: { locations, config, algorithm, distanceMatrix, useStrictMatrix, useConsensus }
     └─ on success: setResult, setOptimizerResults, setUseConsensus (from _meta)
   → ResultPanel
     └─ RouteEditor (edit mode)
         └─ reoptimizeDay (page.tsx:286, 299, 315, 316)
```

### 4.4 Verdict

**Refactor candidate.** Top priority extractions:
- `useOptimizationFlow` (matrix cache + handleOptimize + result state)
- `useRouteEditor` (edit mode + drag handlers)
- `useHomePlacement` (placement mode + drag home + place home)

---

## 5. Testing

### 5.1 Current state — ZERO

- **No test framework** in `package.json` (no `jest`, `vitest`, `@playwright/test` as direct deps).
- **No test files** anywhere (`*.test.*` / `*.spec.*` returns 0 matches).
- **No coverage tool** in devDependencies.
- `package.json` has 5 scripts only: `dev`, `build`, `start`, `lint`, `type-check`. No `test`.
- `.gitignore` includes `/coverage` (`AGENTS.md` confirms) — implies a future intent, but no tool.
- `openspec/config.yaml:21` sets `strict_tdd: false`. `openspec/config.yaml:55-70` records `testing.strict_tdd: false` and `testing.layers.{unit,integration,e2e}.available: false`.
- The only quality gates are `next lint` and `tsc --noEmit`.

### 5.2 Verdict

**Highest-leverage gap.** Adding vitest + a few smoke tests for `unreachableFilter`, `matGet`, and the matrix cache would catch most regressions.

---

## 6. Prettier

### 6.1 Current state — NOT INSTALLED

- No `.prettierrc`, `.prettierrc.json`, `.prettierrc.js`, `prettier.config.js` anywhere.
- `prettier` not in `package.json` devDependencies (only `eslint`, `eslint-config-next`, `autoprefixer`, `postcss`, `tailwindcss`, `typescript`).
- `openspec/config.yaml:70` records `quality.formatter.available: false`.
- `AGENTS.md` line 50 says "**No Prettier**".
- `openspec/config.yaml:78` says: `"No Prettier — consider adding it in a future bootstrap change."`

### 6.2 Verdict

Add `.prettierrc` + `prettier` to devDeps + a `format` npm script. Trivial change.

---

## 7. Error handling

### 7.1 Inventory

| Pattern | Locations |
|---|---|
| `window.alert(msg)` | `src/lib/routeExport.ts:886` (DOCX export failure) — **only place** |
| `.catch(console.error)` | `src/app/page.tsx:736, 791`; `src/app/api/optimize/route.ts:318, 333`; `src/app/api/routing/route.ts:244`; `src/utils/googleRouting.ts:114`; `src/lib/routeExport.ts:883` |
| `try { ... } catch { return null; }` | `src/utils/routing/providers/osrm.ts:55`; `src/app/api/routing/route.ts:67, 91-...`; `src/utils/clientRouting.ts:55, 115` (silent swallow) |
| User-facing error toast | `page.tsx:190, 795-800` — `error` state + 6s auto-dismiss |
| `.catch(() => ({ error: \`HTTP ${status}\` }))` | `page.tsx:633, 645` — graceful JSON parse failure |

### 7.2 Verdict

- **One `window.alert`** in DOCX export — should move to the same `error` state used elsewhere.
- **Many silent `catch` blocks** swallow errors without telemetry. Acceptable for routing provider fallbacks (intentional design), but for the API routes the errors are logged and returned.
- **No centralized error reporting** (no Sentry, no Datadog). Out of scope for this change.

---

## 8. Geoapify credit / source feedback

### 8.1 Current state — INTERNAL TELEMETRY EXISTS, UI DOES NOT

- **ConsensusBuilder tracks counts** internally (`src/utils/routing/consensusBuilder.ts:64-65, 97, 138-182`):
  - `osrmFinite` count
  - `geoapifyCount`, `orsCount` (from batch providers)
- **Progress events stream to UI** via `OnConsensusProgress` (`src/app/api/optimize/route.ts:306-308`, NDJSON `event.type === "progress"`):
  ```ts
  send({ type: "progress", stage: p.stage, current: p.current, total: p.total, detail: p.detail });
  ```
  Includes `geoapifyCount`, `osrmCount` (handled in `page.tsx:603-604`).
- **`_meta` does NOT echo final counts** in the API response (`src/app/api/optimize/route.ts:252-269`):
  ```ts
  _meta: {
    elapsedMs, osrmPairs, totalPairs, unreachableCount,
    ...(useStrictMatrix ? { useStrictMatrix: true } : {}),
    ...(useConsensus ? { useConsensus: true, consensusElapsedMs, consensusEntries } : {}),
    winnerAlgorithm, winnerLabel,
  }
  ```
  No `geoapifyCount`, no `osrmCount` (only `osrmPairs` = total number of matrix entries, **not a per-source count**).
- **UI does not show** routing source breakdown or Geoapify credit usage anywhere.

### 8.2 CRITICAL BUG found — `_meta.routingMode` mismatch

`src/types/index.ts:38-49` defines `isOptimizeMeta` as a type guard that **requires** `routingMode` to be a string:
```ts
return (
  typeof m.elapsedMs === "number" &&
  typeof m.osrmPairs === "number" &&
  typeof m.totalPairs === "number" &&
  typeof m.routingMode === "string"   // ← REQUIRED
);
```

But the API at `src/app/api/optimize/route.ts:252-269` **never sets `routingMode`** in `_meta`. Therefore:
- `isOptimizeMeta(apiData._meta)` always returns `false`.
- `apiMeta` is always `undefined` in `page.tsx:695-696`.
- `setUseConsensus(apiMeta?.useConsensus === true)` is always `false` — **the consensus UI feedback is dead**.

The type guard is correct; the API is the source of the bug.

### 8.3 Verdict

Two fixes needed for this area:
1. **Bug fix**: add `routingMode: "osrm" | "haversine" | "api" | "geoapify"` to `_meta` in `route.ts:252-269` (the field is already declared in the type union at `src/types/index.ts:230`).
2. **Feature**: surface the final `geoapifyCount` / `osrmCount` / `consensusEntries` in the UI as a "telemetry badge" near the routing source indicator.

---

## 9. Server-side i18n

### 9.1 Current state — N/A

- **No `/api/export/route.ts` exists** — export is entirely client-side in `src/lib/routeExport.ts` (894 lines).
- The export function reads locale at runtime from `i18n.language` (`routeExport.ts:873, 884`):
  ```ts
  const lng = options.locale || i18n.language;
  const msg = i18n.t("export.exportError", { lng });
  ```
- Locale validation is implicit — the i18n library coerces any string; invalid locales fall back to the default.
- API routes (`/api/optimize`, `/api/optimize/config`, `/api/routing`) return **hardcoded Spanish** error messages (`route.ts:57, 60, 239, 336`):
  ```ts
  { error: "Se requiere al menos una ubicación." }
  { error: "Coordenadas de casa inválidas." }
  ```

### 9.2 Verdict

The "server-side i18n" question is **moot for export** (no server route). The **real gap** is that API error messages are hardcoded Spanish, breaking pt-BR users who trigger validation errors. Fix is to accept a `locale` query param on the API routes and return localized messages, OR return error codes and let the client map them.

---

## 10. OSRM public API usage

### 10.1 Inventory

| Caller | URL | Timeout | Concurrency | Notes |
|---|---|---|---|---|
| `src/utils/routing/providers/osrm.ts:21` (client, direct) | `https://router.project-osrm.org/route/v1/driving/{a.lng},{a.lat};{b.lng},{b.lat}?overview=full&geometries=geojson&steps=false&alternatives=false` | 5000 ms | 5 (per `service.ts:44`) | AbortController pattern; `null` on any failure |
| `src/app/api/routing/route.ts:39` (server) | Same URL pattern | 10000 ms (`AbortSignal.timeout(10000)` line 42) | 1 per request | Server-side fallback only |
| `src/utils/routing/consensusBuilder.ts:49` (per-pair vote) | Same URL | 5000 ms (provider) | 5 (bounded) | Per-pair vote for cross-validation |
| `src/utils/routing/service.ts:44` (matrix build) | Same URL | 5000 ms | 5 (`MATRIX_CONCURRENCY = 5`) | Bounded worker pool |

### 10.2 Error handling

All callers wrap `fetch` in `try/catch` and return `null` on failure (no error surfaced to UI). The `RoutingService` chain falls through to the next provider; if all fail, the consensus builder records `osrmCount: 0` for that pair and the matrix cell is filled with `Infinity` (per the strict-matrix contract).

### 10.3 Verdict

**Acceptable.** No retry/backoff — direct `fetch` only. Given OSRM's public SLA is best-effort, the "fail fast, fall through" pattern is correct. **Minor improvement**: add a single retry on `null` (some transient failures are recoverable). The 5s timeout is fine; the 10s server-side timeout is more lenient and could be lowered to 5s for parity.

---

## File sizes (required output)

```
1364 src/app/page.tsx
 342 src/app/api/optimize/route.ts
 760 src/utils/routerOptimizer.ts
 162 src/utils/clientRouting.ts
```

## API routes (required output)

```
src/app/api/optimize/route.ts           (POST — runs all optimizers, returns best)
src/app/api/optimize/config/route.ts    (GET  — server capabilities: hasGeoapify, maxLocations)
src/app/api/routing/route.ts            (POST — route geometry: Geoapify > OSRM > Haversine)
```

No `/api/export/route.ts` — export is client-side (`src/lib/routeExport.ts`).

## Critical bug found (cross-cutting)

**`_meta.routingMode` is declared in the type guard (`src/types/index.ts:47`) but never set in the API response (`src/app/api/optimize/route.ts:252-269`)**. This silently breaks `setUseConsensus(apiMeta?.useConsensus === true)` in `page.tsx:696` because `apiMeta` is always `undefined`. The consensus UI feedback is dead. **Fix in 1 line** — add `routingMode` to the `_meta` object in the API.

## Approaches for the change

### Approach A: Single PR with focused fixes (recommended)

Bundle the high-value, low-risk fixes into one PR:

| Fix | Effort | Risk | Files |
|---|---|---|---|
| Add `routingMode` to `_meta` (bug fix) | XS | None | `route.ts:252-269`, possibly `types/index.ts` |
| Replace `window.alert` with toast | XS | None | `routeExport.ts:886` |
| Add Prettier (`.prettierrc` + devDep) | S | None | root + `package.json` |
| Add vitest + 3 smoke tests | M | Low | new files |
| Refactor `page.tsx` into 2-3 hooks | L | Medium | `page.tsx` |

**Effort**: M (2-3 sessions). **Risk**: Low. **Review burden**: ~600-800 LOC. **PR strategy**: single PR or 2 chained PRs (infra → refactor).

### Approach B: Split into chained PRs

1. **PR 1 — infra & bugfixes** (~150 LOC): Prettier, vitest, `_meta.routingMode` fix, replace `window.alert`.
2. **PR 2 — refactor** (~500 LOC): extract `useOptimizationFlow` + `useRouteEditor` hooks from `page.tsx`.
3. **PR 3 — telemetry UI** (optional, ~200 LOC): add source breakdown badge.

**Effort**: M. **Risk**: Low. **Review burden per PR**: <400 LOC. **Strategy**: feature-branch chain.

### Approach C: Just the bugfixes (minimal)

1. PR with the `_meta.routingMode` fix + the `window.alert` replacement.
2. Stop. Defer everything else.

**Effort**: XS (1 session). **Risk**: None. **Review burden**: ~10 LOC. **Strategy**: single PR.

## Recommendation

**Approach A** if the user wants to ship the full "system improvements" package in a single PR. **Approach B** is the safest if the PR-size budget is tight. **Approach C** is the right call if the user only wants the most pressing fix (`_meta.routingMode`) shipped now.

## Risks

- **`page.tsx` refactor** is the riskiest item — it touches a 1364-line file with 30+ state hooks. The chained PR approach (Approach B) is safer.
- **Adding Prettier** will produce a huge diff on first run. Pin Prettier to existing style via `.prettierrc` BEFORE running `prettier --write` to avoid blowing up PRs.
- **Adding vitest** changes the npm scripts — make sure CI (if any) picks it up.
- The `_meta.routingMode` bug is silent — fixing it WILL change the `useConsensus` UI state in existing tests/screenshots. Verify with screenshots before/after.

## Ready for proposal

**Yes** — the 10 areas are mapped, the bug is identified, the refactor is scoped, and the user can pick Approach A / B / C. Recommend orchestrator asks the user to choose the scope.
