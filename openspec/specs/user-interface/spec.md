# User Interface Specification

## Purpose

Source of truth for the `user-interface` capability: design tokens, icon system, accessibility primitives, and discrete UX behaviors (toast lifecycle, DataEditor row visibility, wizard step indicator). Additive — no other capability is modified.

## Design Token Hierarchy

Visual values originate as `--ui-*` CSS custom properties in `globals.css` `:root` (color, radius, shadow, motion, focus ring). `tailwind.config.ts` `theme.extend` exposes them as Tailwind utilities via `var(--ui-*)`; no Tailwind defaults are overridden.

## Requirements

### Requirement: Design Token Coverage

The system MUST define `--ui-*` primitives for color, radius, shadow, and motion. `theme.extend` MUST map them to Tailwind utilities. No Tailwind default SHALL be overridden.

#### Scenario: Token round-trip

- GIVEN `--ui-radius-md` is defined in `globals.css`
- WHEN `theme.extend` binds `borderRadius.md = var(--ui-radius-md)`
- THEN `rounded-md` in JSX yields the same value AND `bg-blue-600` keeps its default

### Requirement: Lucide Icon System

Every UI control icon MUST be a `lucide-react` component. No emoji glyph (Unicode U+1F300–U+1FAFF, U+2600–U+27BF) MAY appear in `.tsx` under `src/components/` or `src/app/`.

#### Scenario: Zero emoji across touched components

- GIVEN the SPA is built
- WHEN `.tsx` files are scanned for emoji codepoints
- THEN zero matches are found in `page.tsx`, `DataEditor`, `ConfigPanel`, `ColumnMapper`, `FileUpload`, `MapView`, `MapPOIActionBar`, `OptimizeButton`, `OptimizeProgress`, `ResultsPanel`

### Requirement: Reusable WizardSteps and ConfigPanel Steppers

The 5-phase progress bar MUST be extracted from `page.tsx` into `src/components/WizardSteps.tsx`. The constraint-type options in `ConfigPanel` MUST render Lucide icons (Clock, MapPin, Zap).

#### Scenario: WizardSteps wired from page.tsx

- GIVEN `phase = "upload"`
- WHEN the component renders
- THEN `<WizardSteps>` shows 5 steps with step 1 active AND clicking step 3 calls `setPhase("review")`

### Requirement: DataEditor Row Visibility

Unselected `ValidatedRow`s MUST render at full opacity. Selection differentiation MUST use background, border, or check state — never `opacity-*` dimming.

#### Scenario: Unselected row is readable

- GIVEN a row with `selected = false`, `isValid = true`
- WHEN DataEditor renders the table
- THEN text, lat, lng, and check icon are at full opacity AND only the checkbox state differs

### Requirement: Error Toast Lifecycle

The error toast MUST animate in on mount, animate out before unmount, auto-dismiss after ~4s, and clear its `setTimeout` on unmount. The close control MUST be a Lucide `X` icon whose `aria-label` MUST be locale-aware via the `t()` function under the key `ariaLabels.closeError`. The visible error label prefix ("Error:" / "Erro:") MUST also flow through `t()` under the key `common.error`.
(Previously: hardcoded `aria-label="Cerrar error"` and visible "Error:" string assumed Spanish only.)

#### Scenario: Auto-dismiss with cleanup

- GIVEN `error` is set
- WHEN the user does not interact for ~4s
- THEN the toast disappears AND `error` becomes `null`
- AND if `page.tsx` unmounts first, the `setTimeout` is cleared (no React warning)

#### Scenario: Manual dismiss

- GIVEN `error` is set
- WHEN the user clicks the close control
- THEN the toast animates out and `error` becomes `null` immediately

#### Scenario: Close control label is locale-aware

- GIVEN the toast is rendered
- WHEN the user inspects the close button
- THEN its `aria-label` resolves through `t("ariaLabels.closeError")`
- AND the value updates when the user switches the locale switcher

### Requirement: Accessibility Primitives

Every icon-only `<button>` MUST have an `aria-label`. Every interactive element MUST expose a `focus-visible:ring-*` outline bound to the `--ui-focus` token. Every `aria-label` whose value is a user-facing label (NOT a technical hint) MUST be resolved through the `t()` function under the `ariaLabels.*` namespace — zero hardcoded Spanish or Portuguese `aria-label` strings MAY appear in component markup.
(Previously: `aria-label` values were hardcoded Spanish strings — assumed a single-language app.)

#### Scenario: Icon-only button labeled and focusable

- GIVEN a button whose only content is a Lucide icon
- WHEN the button renders
- THEN it carries an `aria-label` AND Tab-focus surfaces a ring outline
- AND the `aria-label` value is locale-aware (resolved via `t()`)

#### Scenario: Locale switch changes aria-labels

- GIVEN the app is rendered in `pt-BR`
- WHEN the user picks `es` from the LocaleSwitcher
- THEN every icon-only button's `aria-label` updates to its Spanish translation
- AND no component needs a manual re-render to pick up the new label

#### Scenario: Icon-only button labeled and focusable

- GIVEN a button whose only content is a Lucide icon
- WHEN the button renders
- THEN it carries an `aria-label` AND Tab-focus surfaces a ring outline

### Requirement: Strict Typing and Class Composition

`page.tsx` MUST contain zero `any` types, zero `as unknown as` casts, and zero references to `useConsensusFeature`; the only source of truth is the `useConsensus` state. Class composition in touched components MUST use `cn()` — template-literal `className={`...${cond}`}` is FORBIDDEN.

#### Scenario: page.tsx passes strict gate

- GIVEN the page is built
- WHEN `tsc --noEmit` runs
- THEN zero `any`, zero `as unknown as`, and zero references to `useConsensusFeature` remain

#### Scenario: ResultsPanel stop row uses cn

- GIVEN a stop with `isHome = true`
- WHEN ResultsPanel renders it
- THEN className is built with `cn()` and no template-literal pattern appears

### Requirement: Hook extraction from `page.tsx`

The orchestration state in `page.tsx` MUST be lifted into three custom hooks under `src/hooks/`: `useOptimizationFlow`, `useRouteEditor`, `useHomePlacement`. `page.tsx` MUST be at most 900 lines after extraction. The hooks MUST return the same API surface as the inlined state they replace (no behavior change), and a barrel re-export MUST live at `src/hooks/index.ts`. The hooks MUST be the single owner of their respective concerns (no cross-leakage of phase/result state into editor or home-placement hooks, and vice versa).
(Previously: `page.tsx` was 1364 lines with all flow / editing / home-placement state inlined. The `system-improvements` change decomposed it into 3 hooks and brought the file down to 556 lines.)

#### Scenario: Hooks folder exists and page shrinks

- GIVEN the refactor commits land
- WHEN `wc -l src/app/page.tsx` runs
- THEN the count is ≤ 900 AND `src/hooks/{useOptimizationFlow,useRouteEditor,useHomePlacement}.ts` exist AND `src/hooks/index.ts` re-exports them

#### Scenario: Hook return values match the inlined behavior

- GIVEN the refactor is complete
- WHEN a hook is invoked from `page.tsx`
- THEN the returned state + callbacks match the pre-refactor behavior (verified by `build` + existing lint gates + vitest smoke coverage)

#### Scenario: One hook per concern

- GIVEN a hook file
- WHEN its exports are inspected
- THEN `useOptimizationFlow` owns phase + result + errors, `useRouteEditor` owns edit-mode state, `useHomePlacement` owns the placement mode flag (no cross-leakage)

## Success Criteria

`tsc --noEmit`, `next lint`, `next build` all pass; zero emoji in `src/components/*.tsx` and `src/app/page.tsx`; no `any` in `page.tsx`; `useConsensusFeature` removed; all icon-only `<button>`s have `aria-label`; focus-visible ring on every interactive; error toast animates in/out and auto-dismisses after ~4s with no timer leak; DataEditor unselected rows at full opacity; all 5 wizard screens visually consistent.
