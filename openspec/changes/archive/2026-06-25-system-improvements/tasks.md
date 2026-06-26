# Tasks: System Improvements (single-PR consolidation)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~700 logic + ~1500 Prettier |
| 800-line budget risk | Low (logic) / High with Prettier |
| Chained PRs recommended | No (single PR approved) |
| Delivery strategy | single-pr |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
800-line budget risk: Low

## Phase 1: Fix `_meta.routingMode`
- [x] 1.1 `route.ts:252`: derive `routingMode` from `strictMatrix` (priority `geoapify`>`osrm`>`api`>`haversine`); add counts
- [x] 1.2 `isOptimizeMeta(meta)` true; build/lint/type-check green

## Phase 2: Toast infrastructure
- [x] 2.1 `src/lib/toast.tsx` — `ToastProvider` + `useToast(): { show(msg, { kind, durationMs? }) }`, default 4000ms
- [x] 2.2 `src/components/ToastHost.tsx` — top-right, z-50, × close, auto-dismiss
- [x] 2.3 Mount `<ToastProvider>` in `layout.tsx`

## Phase 3: Replace `window.alert`
- [x] 3.1 `routeExport.ts:886`: add `onError?: (msg) => void` to `downloadRoutePlan`; drop `window.alert`
- [x] 3.2 `page.tsx`: pass `onError={(m) => toast.show(m, { kind: "error" })}`; `rg "window\.alert" src` → 0

## Phase 4: Consistent error handling
- [x] 4.1 `page.tsx`: replace `.catch((err) => console.error(...))` (L735, L754, L790) with `notifyError(err, fallback)` → `toast.show` + `setError`

## Phase 5: Hook `useOptimizationFlow`
- [x] 5.1 `src/hooks/useOptimizationFlow.ts` owns phase/loading/error/result/optimizerResults/activeAlgorithm/routingMode/routeGeometry/routeSource/optimizePhase/handleOptimize/refetchGeometries/pickRoutingMode
- [x] 5.2 Wire into `page.tsx`; pass to `OptimizeButton`/`OptimizeProgress`/`ResultsPanel`

## Phase 6: Hook `useRouteEditor`
- [x] 6.1 `src/hooks/useRouteEditor.ts` owns editMode/editorDirty/editDaysPreview/undo-redo (cap 20)/drag-drop/handleApply/handleDiscard/toggleEditMode/editorRef
- [x] 6.2 Wire into `page.tsx`; pass to `<RouteEditor>`. Drag+undo smoke OK

## Phase 7: Hook `useHomePlacement`
- [x] 7.1 `src/hooks/useHomePlacement.ts` owns placementMode/handlePlaceHome/handleTogglePlaceHome/handleDragHome
- [x] 7.2 Wire into `page.tsx`; pass `placementMode` + `onPlaceHome` to `<MapView>`

## Phase 8: Post-hook cleanup
- [x] 8.1 `page.tsx`: remove dead `useState`/`useRef`, orphan imports, log blocks. Add `src/hooks/index.ts` barrel
- [x] 8.2 `wc -l page.tsx` ≤ 900 (target ≤ 800); build/lint/type-check green

## Phase 9: RoutingModeBadge in `ResultsPanel`
- [x] 9.1 `src/components/RoutingModeBadge.tsx` — pill with routingMode + unreachableCount; localized
- [x] 9.2 Mount in `ResultsPanel.tsx` near header; guard with `isOptimizeMeta(meta)`

## Phase 10: Activate `useStrictMatrix` default
- [x] 10.1 `types/index.ts`: drop `Config.useStrictMatrix` (L109) + `_meta.useStrictMatrix` (L238); `strictMatrix: DistanceMatrix` required
- [x] 10.2 `route.ts`: drop `useStrictMatrix` parse (L37-51, L77, L92-94, L189, L251, L257); always build `DistanceMatrix`
- [x] 10.3 `routerOptimizer.ts`/`geneticOptimizer.ts`/`nsga2.ts`: drop `if (strictMatrix)` branch in `matGet`/`pd`; export `matGet`
- [x] 10.4 `unreachableFilter.ts`: drop `isStrict` detection; always strict
- [x] 10.5 `page.tsx:565`: drop `useStrictMatrix` from body. Update spec. `rg "useStrictMatrix" src` → 0

## Phase 11: Add vitest + tests
- [x] 11.1 devDeps (`vitest`, `jsdom`, `vite-tsconfig-paths`); `test`/`test:run` scripts; `vitest.config.ts` (jsdom, `globals: true`, `@/*` alias)
- [x] 11.2 `unreachableFilter.test.ts` — all-reachable, one-unreachable, tiny-pair
- [x] 11.3 `routerOptimizer.test.ts` — `matGet` Infinity + valid lookup
- [x] 11.4 `nsga2.test.ts` — 5-POI; non-empty Pareto + finite `totalDistance`
- [x] 11.5 Update `openspec/config.yaml` `testing:` + verify/apply test_command. `npm run test:run` exits 0 with ≥ 3 files

## Phase 12: Add Prettier
- [x] 12.1 `.prettierrc` (`singleQuote`, `trailingComma: "all"`, `printWidth: 100`, `tabWidth: 2`, `semi: true`, `arrowParens: "always"`). Add `prettier` devDep + `format`/`format:check` scripts
- [x] 12.2 `npx prettier --write "src/**/*.{ts,tsx}"`; commit sweep. `format:check` exits 0
