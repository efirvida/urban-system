# Archive Report: System Improvements

**Change:** `system-improvements`
**Archived:** 2026-06-25
**Archived to:** `openspec/changes/archive/2026-06-25-system-improvements/`
**Mode:** hybrid (engram + openspec filesystem)
**Reconciler:** sdd-archive (minimax-m3)

## Source artifacts (preserved in archive folder)

| File | Status |
|------|--------|
| `proposal.md` | ✅ preserved (success criteria reconciled) |
| `spec.md` | ✅ preserved (delta specs merged into source-of-truth) |
| `design.md` | ✅ preserved (open questions resolved) |
| `tasks.md` | ✅ preserved (all 28 checkboxes reconciled — see Archive Notes) |
| `verify-report.md` | ✅ preserved (PASS WITH WARNINGS, 10/10 areas) |

## Specs synced to source-of-truth

| Source-of-truth spec | Action | Details |
|----------------------|--------|---------|
| `openspec/specs/strict-matrix-contract/spec.md` | **Modified** | Replaced the `useStrictMatrix` flag requirement with the new "DistanceMatrix is the standard contract" requirement. Removed the `useStrictMatrix: false` (default) and `useStrictMatrix: true` scenarios, replaced with "API always builds `DistanceMatrix`" + "Optimizers read `entry.distance`" + "Legacy `useStrictMatrix: true` from older clients (ignored)". Updated Tiny-pair scenario to reflect the matrix pre-populates the Haversine entry. Updated Constraints: `Config.useStrictMatrix` and the request field are no longer part of the public contract. |
| `openspec/specs/routing-source-tracking/spec.md` | **Modified** | Added the "`_meta.routingMode` is always populated" requirement with three scenarios (always populated, `"haversine"` mode, mixed matrix). Added the "Routing-mode UI badge in `ResultsPanel`" requirement (top-right of `ResultsPanel`, hidden when no `_meta`). Updated the "Per-pair routing-source visibility" requirement to require `_meta.routingMode` MUST always be populated. Updated the badge location note in `Out of scope` from "bottom-left badge" to "top-right `RoutingModeBadge` in `ResultsPanel`". |
| `openspec/specs/user-interface/spec.md` | **Modified** | Added the "Hook extraction from `page.tsx`" requirement with three scenarios (hooks folder + page shrink, hook return values match inlined behavior, one hook per concern). The 900-line budget and the `src/hooks/index.ts` barrel are now part of the spec. |
| `openspec/specs/toast-notifications/spec.md` | **Created** | New source-of-truth spec for the toast notification system. Extracted from delta spec section 4 (Requirements: Toast context + host, with the four scenarios). |
| `openspec/specs/testing-infrastructure/spec.md` | **Created** | New source-of-truth spec for vitest setup. Extracted from delta spec section 5 (Requirements: vitest configured, smoke coverage for pure helpers, with the five scenarios). |

### Diff summary

- 2 source-of-truth specs rewritten (strict-matrix-contract, routing-source-tracking)
- 1 source-of-truth spec appended (user-interface — new requirement added)
- 2 new source-of-truth specs created (toast-notifications, testing-infrastructure)

## Verification snapshot

The verify-report (`openspec/changes/archive/2026-06-25-system-improvements/verify-report.md`) is the source of truth for completion.

| Quality gate | Result |
|--------------|--------|
| `npm run type-check` | PASS (0 errors) |
| `npm run lint` | PASS (1 pre-existing warning in `MapView.tsx:137` — unrelated to this change) |
| `npm run build` | PASS (`✓ Compiled successfully`, 7/7 static pages, route bundle 435 kB) |
| `npm run test:run` | PASS — 3 test files, **10/10 tests green** in 11.23 s |
| `npm run format:check` | PASS — `All matched files use Prettier code style!` |

| Per-criterion | Verdict |
|---------------|---------|
| 1. `_meta.routingMode` fix | PASS |
| 2. `useStrictMatrix` removed (default strict) | PASS |
| 3. Toast notifications | PASS |
| 4. Prettier | PASS |
| 5. vitest | PASS |
| 6. Hook extraction | PASS |
| 7. `RoutingModeBadge` | PASS |
| 8. Error handling (no `window.alert`, no silent `.catch(console.error)`) | PASS |
| 9. NSGA-II convergence test | PASS |
| 10. `openspec/config.yaml` updated | PASS |

| Final tally | Count |
|-------------|-------|
| PASS | 10 |
| CRITICAL | 0 |
| WARNING | 1 (stale source-spec files — resolved by this archive) |
| SUGGESTION | 2 (vite-tsconfig-paths native, pre-existing lint warning — both unrelated) |

**Verdict: PASS WITH WARNINGS — archive-eligible after source-spec reconciliation (completed in this archive).**

## Apply progress (13 commits)

| # | Commit | Phase |
|---|--------|-------|
| 1 | `1b9d9dc` | fix(api): populate _meta.routingMode and add per-pair source counts |
| 2 | `e7a1d48` | feat(ui): add toast notification system |
| 3 | `fa4689f` | refactor(export): route errors through callback, drop window.alert fallback |
| 4 | `ce899d7` | refactor(ui): route background errors through toast channel |
| 5 | `2ca9daf` | refactor(hooks): add useOptimizationFlow hook |
| 6 | `65ed1cf` | refactor(hooks): add useRouteEditor hook |
| 7 | `5cee608` | refactor(hooks): add useHomePlacement hook and barrel |
| 8 | `95a653c` | refactor(ui): wire extracted hooks into page.tsx and slim it down |
| 9 | `91eac61` | feat(ui): add RoutingModeBadge to ResultsPanel |
| 10 | `c32af46` | feat!: activate useStrictMatrix as the standard contract |
| 11 | `9749a8c` | test: add vitest setup and smoke coverage for pure helpers |
| 12 | `e0da70f` | style: add Prettier and run on entire src/ |
| 13 | `7074770` | chore: format globals.css and root JSON with Prettier |

`page.tsx`: 1364 → 556 lines (target ≤ 900; design target ≤ 800; achieved 556).

## Archive Notes

### Archive-time stale-checkbox reconciliation

The `sdd-apply` agent committed all 13 phases and the verify-report confirmed
every task is implemented and tested, but the persisted `tasks` artifact
(both `openspec/changes/system-improvements/tasks.md` and the engram
`sdd/system-improvements/tasks` observation, #1426) was never updated to
mark the 28 checkboxes as complete.

The orchestrator explicitly authorized the archive-time reconciliation.
The proof of completion is:

- Engram apply-progress observation `#1429` (sdd/system-improvements/apply-progress) — lists all 13 commit SHAs and confirms all quality gates are green.
- Engram verify-report observation `#1430` (sdd/system-improvements/verify-report) — 10/10 areas PASS, 0 CRITICAL, every criterion with file:line evidence.
- Filesystem `verify-report.md` — same content as #1430.

Reconciliation actions taken at archive time:

1. `openspec/changes/archive/2026-06-25-system-improvements/tasks.md` — all 28 `- [ ]` → `- [x]`.
2. Engram observation `#1426` — content updated with all checkboxes marked complete and a leading archive note recording the reconciliation reason. Observation ID preserved (not duplicated).
3. `proposal.md` — 5 success-criteria checkboxes marked complete (all verified PASS).
4. `design.md` — 2 open questions marked resolved (both decisions landed in apply, confirmed by verify-report).

### Stale source-of-truth spec fix

The verify-report WARNING flagged that `openspec/specs/strict-matrix-contract/spec.md` and `openspec/specs/routing-source-tracking/spec.md` were not updated when the implementation was merged. Both are now brought into sync with the implemented state. The `user-interface` spec also picked up the new hook extraction requirement from delta spec section 3.

### Non-blocking suggestions carried forward (not part of this change)

- `vite-tsconfig-paths` devDep is now redundant (Vite resolves `tsconfigPaths` natively). Could be removed in a follow-up.
- `MapView.tsx:137` has a pre-existing `react-hooks/exhaustive-deps` warning that pre-dates this change.

## Source-of-truth files updated

| File | Change |
|------|--------|
| `openspec/specs/strict-matrix-contract/spec.md` | Rewrote `useStrictMatrix` flag → new DistanceMatrix standard contract; removed legacy flag scenarios; updated tiny-pair scenario; updated constraints. |
| `openspec/specs/routing-source-tracking/spec.md` | Added `_meta.routingMode` always-populated requirement; added RoutingModeBadge in `ResultsPanel` requirement; corrected badge location (bottom-left → top-right). |
| `openspec/specs/user-interface/spec.md` | Added Hook extraction from `page.tsx` requirement. |
| `openspec/specs/toast-notifications/spec.md` | NEW — extracted from delta spec section 4. |
| `openspec/specs/testing-infrastructure/spec.md` | NEW — extracted from delta spec section 5. |

## Engram observations referenced

| ID | Topic | Role |
|----|-------|------|
| `#1426` | `sdd/system-improvements/tasks` | Tasks artifact (reconciled) |
| `#1429` | `sdd/system-improvements/apply-progress` | Source of truth for completion |
| `#1430` | `sdd/system-improvements/verify-report` | Source of truth for verification |
| (this save) | `sdd/system-improvements/archive-report` | Archive closure record |

## SDD cycle status

**COMPLETE.** The `system-improvements` change has been planned, designed, specified, implemented (13 commits), verified (10/10 areas PASS, all quality gates green), and archived. The two stale source-of-truth specs flagged by the verify-report WARNING were fixed in this archive. Five source-of-truth specs are now in sync with the implemented state. The repo is ready for the next change.
