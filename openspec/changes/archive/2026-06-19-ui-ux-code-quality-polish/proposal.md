# Proposal: UI/UX & Code Quality Polish

## Intent

The SPA works but shows its growth: mixed emoji + Lucide icons, ad-hoc colors/radius/shadows, an `opacity-40` DataEditor state that hides unselected rows, an error toast without animation or auto-dismiss, and `page.tsx` at 1246 lines carrying `any` types, a hardcoded `useConsensusFeature` constant, an `as unknown as DayRoute[]` cast, and template-literal classnames that bypass `cn()`. This change applies a visual foundation + safe code-quality fixes without touching optimizer, routing, parser, or state-management logic.

## Scope

### In Scope
- **Visual foundation + component refinement**: CSS design tokens (color, radius, shadow, motion); replace UI emojis with Lucide; fix `opacity-40` on DataEditor; template-literal classes → `cn()` in ResultsPanel; ConfigPanel steppers → Lucide; error toast with animation + auto-dismiss; extract 5-step progress bar into `<WizardSteps>`; `aria-label`s and `focus-visible:ring-*`.
- **Code quality**: drop `any` and `as unknown as DayRoute[]`; remove `useConsensusFeature`; replace remaining template-literal classnames with `cn()`.

### Out of Scope
- Custom-hook extraction from `page.tsx` (state-management; high regression risk)
- Optimizer, routing, parser, or cache changes
- Map component refinements — separate scope

## Capabilities

### New Capabilities
- `user-interface`: design tokens, icon system, accessibility primitives, and user-observable UX behaviors (toast lifecycle, DataEditor row visibility, wizard step indicator). Becomes `openspec/specs/user-interface/spec.md`.

### Modified Capabilities
None. Existing capabilities keep their requirements — this change is additive.

## Approach

Add `--ui-*` CSS custom properties in `globals.css`; extend `tailwind.config.ts` `theme.extend` (no overrides). `lucide-react` is already a dep — replace every UI emoji 1:1 with the closest semantic Lucide icon (mapping in `design.md`). Extract the 5-step progress bar from `page.tsx` into a leaf `<WizardSteps>`. Add `aria-label`s on icon-only `<button>`s; `focus-visible:ring-2` on clickables. Error toast: CSS transition + `setTimeout` + `useEffect` cleanup. Type tightening: `WizardStepId` literal union; `isDayRouteArray()` guard in `src/types/index.ts`.

## Affected Areas

- **Modified**: `globals.css`, `tailwind.config.ts`, `page.tsx`, 10 component files, `src/types/index.ts`.
- **New**: `src/components/WizardSteps.tsx`.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Visual regression on a wizard step | Med | One-commit Phase 1; manual smoke-test of all 5 steps |
| Token-name collision with Tailwind defaults | Low | Prefix `--ui-*`; only `extend` |
| Toast timer leak on unmount | Low | `useEffect` cleanup clears `setTimeout` |
| `any` removal breaks an edge case | Low | Per-file diff; `tsc --noEmit` gates merge |
| Type guard rejects valid `DayRoute[]` | Low | Guard mirrors `DayRoute` shape; one call site |

## Rollback Plan

1. `git revert` the merge — pure CSS/component swaps; no data, DB, or API contract touched.
2. CSS tokens are additive (`theme.extend`); reverting restores Tailwind defaults.
3. `<WizardSteps>` is a leaf with one consumer; reverting the import reinstates the inline version.
4. The type guard is purely additive — a bad guard breaks one call site, flagged by `tsc --noEmit`.

## Dependencies

None new. `lucide-react` is already in `package.json`.

## Success Criteria

- [ ] Zero emoji glyphs in `src/components/*.tsx` and `src/app/page.tsx`
- [ ] `tsc --noEmit`, `next lint`, `next build` all pass
- [ ] No `any` types in `src/app/page.tsx`; `useConsensusFeature` removed
- [ ] All icon-only `<button>`s have `aria-label`; DataEditor unselected rows at full opacity
- [ ] Error toast animates in/out and auto-dismisses after ~4s
- [ ] All 5 wizard screens visually consistent
- [ ] `openspec/specs/user-interface/spec.md` exists with token-system, toast, and DataEditor-visibility requirements
