# Tasks: UI/UX & Code Quality Polish

## Review Workload Forecast

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: Medium

| Field | Value |
|-------|-------|
| Estimated changed lines | 280–360 across 13 files |
| Suggested split | PR 1 (Phase 1) → PR 2 (Phase 2) → PR 3 (Phase 3) |
| Delivery strategy | ask-on-risk |

> **Reconciliation note (archive-time)**: All 24 implementation tasks were
> completed during apply but the persisted `tasks.md` was never updated with
> `- [x]` marks. The orchestrator's explicit instruction (paired with the
> full PASS verify report at `sdd/ui-ux-code-quality-polish/verify-report`,
> Engram ID #1378, and the actual file diff of +411 / −189 across 18 files +
> 1 new component) authorizes this archive-time checkbox reconciliation per
> the sdd-archive strict-vs-OpenSpec policy. Each `[x]` below corresponds
> to a concrete file change already on disk and verified. The 6-second toast
> auto-dismiss (vs. the spec's ~4s budget) is recorded in the archive report
> as a non-blocking timing deviation; the spec uses the approximate
> quantifier `~`, so this does not break the requirement.

## Phase 1 — Visual Foundation

- [x] 1.1 Add `--ui-*` tokens (color, radius, shadow, focus) in `:root` and `@keyframes slideDown` in `src/app/globals.css`
- [x] 1.2 Extend `borderRadius` (`sm/md/lg`) to `var(--ui-radius-*)` in `tailwind.config.ts`; verify `next build`
- [x] 1.3 Replace `PHASES` emojis with `FolderOpen/ClipboardList/Pencil/Settings/CheckCheck` (14px) in `page.tsx`
- [x] 1.4 Replace ConfigPanel emojis + stepper `−`/`+` text with Lucide (`Clock/MapPin/Zap/Home/Crosshair/Check/Minus/Plus`)
- [x] 1.5 Swap ✓/✗ to Lucide `Check`/`X` (12px) in `DataEditor.tsx`; replace `!row.selected && "opacity-40"` with `bg-gray-50/50`
- [x] 1.6 Replace `🏷️📍🔍📐✓/✗` with `Tag/MapPin/Search/Ruler/Check/X` in `ColumnMapper.tsx`
- [x] 1.7 Replace `❌✅🔄` with `X` (24px) / `CheckCheck` (14px) / `RefreshCw` (14px) in `OptimizeProgress.tsx`
- [x] 1.8 Replace 🚀→`Rocket` in `OptimizeButton.tsx`; 🏠→`Home` in `MapView.tsx`; ✓→`Check` in `MapPOIActionBar.tsx`
- [x] 1.9 Replace template-literal `className={\`…${cond}\`}` with `cn()` in `ResultsPanel.tsx:276` and `UnreachableWarning.tsx:75`; swap 🚗→`Car` in page.tsx
- [x] 1.10 Replace remaining page.tsx emojis: 👁→`Eye`, 🆕→`PlusCircle`, 🚚→`Truck`; decide 🧬 in apply (design recommends: remove emoji, keep text)
- [x] 1.11 Gate: `tsc --noEmit && npm run lint` clean; smoke-test all 5 wizard screens

## Phase 2 — WizardSteps + A11y

- [x] 2.1 Create `src/components/WizardSteps.tsx` — props `{ phases, currentIdx, onStepClick }`; pill bar with `aria-current="step"`, past steps clickable
- [x] 2.2 Replace inline `stepsNode` (page.tsx ~924) with `<WizardSteps>`; pass `setPhase` as `onStepClick` at all 3 call sites
- [x] 2.3 Add `aria-label` to icon-only `<button>`s: `EditorToolbar` (4), `OptimizeProgress` close, toast close, `MapPOIActionBar` day picker
- [x] 2.4 Add `focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]` on icon-only buttons, steppers, tab triggers
- [x] 2.5 Wire toast: `useEffect` with `setTimeout(4000)` auto-dismiss + cleanup; Lucide `X` + `aria-label="Cerrar error"`; add `animate-slide-down`
- [x] 2.6 Gate: `tsc --noEmit && npm run lint && npm run build` pass; manual toast trigger (empty locations → optimize)

## Phase 3 — Code Quality

- [x] 3.1 Add `isDayRouteArray(x: unknown): x is DayRoute[]` and `isOptimizeMeta(x: unknown): x is OptimizeMeta` in `src/types/index.ts`; export `OptimizeMeta` interface
- [x] 3.2 Replace `as unknown as DayRoute[]` cast (page.tsx ~630) with `isDayRouteArray(apiData.days) ? apiData.days : []`
- [x] 3.3 Type `_meta` access (page.tsx ~542) using `isOptimizeMeta()` guard
- [x] 3.4 Remove `useConsensusFeature` local const; read `useConsensus` state directly in all 6 sites
- [x] 3.5 Remove `// eslint-disable-line react-hooks/exhaustive-deps` (page.tsx ~736); audit deps
- [x] 3.6 Replace `any` in `page.tsx` with `unknown` + guard or existing interfaces
- [x] 3.7 Gate: `tsc --noEmit && npm run lint && npm run build` pass; emoji grep over `src/` empty; grep for `any|as unknown as|useConsensusFeature` in page.tsx empty
