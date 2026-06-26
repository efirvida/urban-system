# Design: System Improvements (single-PR consolidation)

## Technical Approach

One PR, ten items, ordered to isolate cosmetic changes from logic changes. The architecture retains existing module boundaries (`src/{app,components,hooks,lib,types,utils}`) while introducing a new `src/hooks/` directory for the three extracted hooks. No runtime dependencies are added; only dev deps (`vitest`, `prettier`, `jsdom`).

## Architecture Decisions

### ADR-1: Toast notification system

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `sonner` (npm) | Rich API, but adds 23 kB + peer dep overhead | ❌ |
| `react-hot-toast` (npm) | Headless, 5 kB, but another dep | ❌ |
| Custom context + host | Zero deps, ~60 LOC, matches existing Tailwind patterns | ✅ |

**Rationale**: The change only needs `show(msg, kind, durationMs?)` — a single `useToast()` hook. A custom `ToastProvider` wraps the app root in `layout.tsx`, exposes state via React context. The `<ToastHost>` is one fixed `<div>` at top-right (`z-50`). No library is worth the dependency for this API surface.

**API**: `show(msg: string, opts?: { kind?: "error" | "info"; durationMs?: number }): void` — returned by `useToast()`. Auto-dismiss defaults to 4000 ms. Manual close: click × button on toast body.

**Flow**: `show()` → `setToasts(prev => [...prev, { id, msg, kind, timer }])` → `ToastHost` maps active toasts → `setTimeout(id, durationMs)` auto-removes. Export `downloadRoutePlan` and page-level catch handlers call `show()` instead of `window.alert` / `console.error`.

### ADR-2: Hook extraction boundaries

| Hook | Owns | Returns |
|------|------|---------|
| `useOptimizationFlow` | Phase management, `handleOptimize` (matrix + API + parse), loading/error/result state | `{ phase, loading, error, result, optimizerResults, activeAlgorithm, ...handleX }` |
| `useRouteEditor` | `editMode`, `editorDirty`, `editDaysPreview`, undo/redo, drag-drop, `handleApply`, `handleDiscard`, `toggleEditMode`, POI preview logic | `{ editMode, editorDirty, ...handlers, editorRef }` |
| `useHomePlacement` | `placementMode`, home coord state in config, geolocation | `{ placementMode, handlePlaceHome, handleTogglePlaceHome, handleDragHome }` |

**Data flow**: Hooks receive shared state as props (config, locations, result). page.tsx remains the orchestrator — it passes props down to hooks and components. No context for optimization flow (the hooks are co-located in page.tsx). Toast context is the only new context, mounted in `layout.tsx`.

**page.tsx after extraction**: ~700 lines. Phased callbacks (`handleFileLoaded`, `handleMappingConfirm`, `handleReviewConfirm`) stay in page.tsx since they are phase transitions, not flow internals.

### ADR-3: useStrictMatrix removal strategy

| Location | Current state | After |
|----------|--------------|-------|
| `types/index.ts` `Config.useStrictMatrix?` | Optional boolean | Removed |
| `types/index.ts` `_meta.useStrictMatrix?` | Optional boolean | Removed |
| `types/index.ts` `OptimizeResponse.strictMatrix?` | Conditional on flag | Always present |
| `page.tsx` request body | `useStrictMatrix: config?.useStrictMatrix ?? false` | Remove field from payload |
| `route.ts` request parsing | `const useStrictMatrix = ...` block | Remove parsing; always set `strictMatrix` |
| `route.ts` matrix section | `if (useStrictMatrix) { ... }` | Always build `DistanceMatrix` |
| `route.ts` pre-filter branch | `useStrictMatrix && strictMatrix ? filterUnreachable(..., strictMatrix) : filterUnreachable(..., matrix)` | Always call with `strictMatrix` |
| `route.ts` optimizer params | `strictMatrix: useStrictMatrix ? strictMatrix : undefined` | Always pass `strictMatrix` |
| `route.ts` response spread | `...(useStrictMatrix && strictMatrix ? { strictMatrix } : {})` | Always include |
| `routerOptimizer.ts` `matGet` | Two paths (strict + legacy) | Keep both paths but `strictMatrix` is always provided; legacy fallback retained for internal callers without a matrix |
| `geneticOptimizer.ts` `pd` | Two paths | Always receives `strictMatrix` |
| `nsga2.ts` `pd` | Two paths | Always receives `strictMatrix` |
| ORS/Geoapify optimizers `matGet` | Read `Record<string, number>` only | No change — they read `matrix` (flat), not `strictMatrix` |
| `unreachableFilter.ts` | `isStrict` detection | Always strict path |

**Backwards compat**: Remove parsing of `useStrictMatrix` from request body; ignore the field if sent. The `_meta.useStrictMatrix` echo is removed. Response always includes `strictMatrix`.

### ADR-4: Testing strategy

| What to test | How |
|-------------|-----|
| `filterUnreachable` (both paths) | Pure function; pass `DistanceMatrix` with mixed sources; assert reachable/unreachable counts |
| `matGet` from `routerOptimizer.ts` | Export for tests; test Infinity for missing key, correct distance lookup |
| NSGA-II convergence (5 POIs) | Fixed seed matrix; assert `paretoFront.length > 0` and `totalDistance` within upper bound |
| `isOptimizeMeta` type guard | Pass objects with/without `routingMode`; assert pass/fail |

**What NOT to test**: Next.js API routes (need integration harness), Leaflet components (DOM-dependent, out of scope), export functions (tested manually).

**NSGA-II timeout**: The 30s guard lives in the nsga2 optimizer wrapper (`src/utils/optimizer/optimizers/nsga2.ts`), not in the core `runNSGA2`. For the smoke test, call `runNSGA2` directly with a 5-POI matrix — it completes in <2s with POP=80, GENS=100. No timeout override needed.

**Mock strategy**: No mocks. Smoke tests use hand-crafted `DistanceMatrix` objects. NSGA-II test seeds `Math.random` via `vi.stubGlobal` if non-determinism blocks assertions, otherwise validate statistical bounds (front non-empty, distance finite).

### ADR-5: Commit order

```
1. vitest config + .prettierrc + package.json scripts     (tooling, no logic change)
2. Fix _meta.routingMode in route.ts                       (critical bugfix)
3. Toast system: context + host + replace window.alert     (UI: errors visible)
4. RoutingModeBadge in ResultsPanel                        (UI: telemetry visible)
5. Extract useOptimizationFlow hook                        (refactor, 1 hook)
6. Extract useRouteEditor hook                             (refactor, 1 hook)
7. Extract useHomePlacement hook                           (refactor, 1 hook)
8. Consistent error handling (replace .catch(console.error)) (quality)
9. Remove useStrictMatrix flag everywhere                  (highest-risk, isolated)
10. Prettier run on entire src/                            (LAST — cosmetic diff)
```

**Rationale**: Tooling first so every subsequent commit can `lint && type-check && test:run`. Bugfix second because it's critical. Toast before badge so error display works. Hooks before strict-matrix so the refactor doesn't compound risk. Strict-matrix is second-to-last for revertibility. Prettier MUST be last — its diff is large but purely cosmetic, and putting it last prevents it from obscuring logic changes in `git log -p`.

## Data Flow

### Optimization flow (after hook extraction)

```
page.tsx (orchestrator)
  │
  ├── useOptimizationFlow(config, locations)
  │     └─ handleOptimize()
  │          ├─ buildDistanceMatrices() → distances
  │          ├─ POST /api/optimize → parse NDJSON/JSON
  │          ├─ setResult(), setOptimizerResults()
  │          └─ fetchAllRouteGeometries() → setRouteGeometry()
  │
  ├── useRouteEditor(result, config, locations, matrix)
  │     └─ RouteEditor (child component)
  │          ├─ handleApply(newDays) → setResult(updated)
  │          └─ refetchGeometries(newDays)
  │
  └── useHomePlacement(config, setConfig)
        └─ MapView (placementMode, onPlaceHome, onDragHome)
```

### Toast notification flow

```
caller → useToast().show("Something failed", { kind: "error" })
  │
  ▼
ToastProvider (context)
  │
  ▼
ToastHost (fixed top-right, z-50)
  ├─ render <ToastCard msg kind />
  ├─ setTimeout(4000) → remove
  └─ user clicks × → remove
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/hooks/useOptimizationFlow.ts` | Create | Phase, optimize, result, error, algorithm state |
| `src/hooks/useRouteEditor.ts` | Create | Edit mode, undo/redo, preview, apply/discard |
| `src/hooks/useHomePlacement.ts` | Create | Home placement mode + callbacks |
| `src/hooks/index.ts` | Create | Barrel re-export |
| `src/components/ToastHost.tsx` | Create | Fixed-position toast renderer |
| `src/lib/toast.tsx` | Create | ToastProvider + useToast context |
| `src/components/RoutingModeBadge.tsx` | Create | Badge: mode + unreachable count |
| `src/utils/unreachableFilter.test.ts` | Create | Legacy + strict path smoke |
| `src/utils/routerOptimizer.test.ts` | Create | matGet smoke |
| `src/utils/nsga2.test.ts` | Create | NSGA-II 5-POI convergence |
| `vitest.config.ts` | Create | jsdom, @/* alias, globals |
| `.prettierrc` | Create | Existing style (single quotes, trailing commas, 2-space) |
| `src/app/api/optimize/route.ts` | Modify | Set `routingMode`; remove `useStrictMatrix`; always build `DistanceMatrix` |
| `src/app/page.tsx` | Modify | Lift state to hooks; replace `.catch(console.error)` with toast |
| `src/app/layout.tsx` | Modify | Add `<ToastProvider>` wrapper |
| `src/types/index.ts` | Modify | Remove `Config.useStrictMatrix`; remove `_meta.useStrictMatrix`; make `strictMatrix` non-conditional |
| `src/lib/routeExport.ts` | Modify | Replace `window.alert` with toast (export as callback param) |
| `src/components/ResultsPanel.tsx` | Modify | Render `<RoutingModeBadge>` when `_meta` present |
| `src/utils/routerOptimizer.ts` | Modify | Remove `strictMatrix?` optional from `matGet` signature (always provided); export `matGet` |
| `src/utils/geneticOptimizer.ts` | Modify | Remove legacy path from `pd` (always strict) |
| `src/utils/nsga2.ts` | Modify | Remove legacy path from `pd` (always strict) |
| `src/utils/unreachableFilter.ts` | Modify | Remove `isStrict` detection; always strict path |
| `src/utils/optimizer/types.ts` | Modify | Make `strictMatrix` required in `OptimizeParams` |
| `package.json` | Modify | Add `test`, `test:run`, `format`, `format:check` scripts; add devDeps |
| `openspec/config.yaml` | Modify | Update testing section, formatter |
| `openspec/specs/strict-matrix-contract/spec.md` | Modify | Remove `useStrictMatrix` references |
| `openspec/specs/routing-source-tracking/spec.md` | Modify | `_meta.routingMode` required |

## Interfaces / Contracts

```typescript
// Toast API — src/lib/toast.tsx
interface ToastOpts {
  kind?: "error" | "info";
  durationMs?: number;
}
function useToast(): { show: (msg: string, opts?: ToastOpts) => void };

// OptimizeParams (after change) — strictMatrix required
interface OptimizeParams {
  locations: Location[];
  home: Location;
  config: Config;
  matrix: Record<string, number>;         // legacy flat matrix (still used by ORS/Geoapify optimizers)
  strictMatrix: DistanceMatrix;           // NOW REQUIRED
  consensusMatrix?: ConsensusMatrix;
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `filterUnreachable` | Pure function, hand-crafted `DistanceMatrix` |
| Unit | `matGet` | Exported; test Infinity + valid lookup |
| Unit | NSGA-II convergence | 5-POI deterministic matrix; assert front non-empty, distance finite |
| - | API routes | Not tested (require integration harness) |
| - | Leaflet components | Not tested (DOM-dependent, out of scope) |
| - | Export functions | Not tested (side-effect heavy; manual QA) |

## Migration / Rollout

No data migration required. The PR is atomic — all changes land together. Rollback: `git revert` the merge commit. If partial revert is needed, commits 9 (useStrictMatrix) and 10 (Prettier) are the highest-risk but independently revertible.

## Open Questions

> Resolved during apply (2026-06-25). Kept here as a record of the
> decisions that shaped the implementation.

- [x] Should `downloadRoutePlanDocx` accept a `showToast` callback, or should we make the export async error surfacing through the calling component? **Decision: pass `onError?: (msg: string) => void` to `downloadRoutePlan`** (proposed option was taken — see verify-report criterion #3; `routeExport.ts:858,862,864`).
- [x] Prettier config: tabs or spaces? Comma-dangle? **Decision: match existing style — single quotes, trailing commas, 2 spaces** (see verify-report criterion #4; `.prettierrc` values: `singleQuote: true`, `trailingComma: "all"`, `printWidth: 100`, `tabWidth: 2`, `semi: true`, `arrowParens: "always"`).
