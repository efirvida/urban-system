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

The error toast MUST animate in on mount, animate out before unmount, auto-dismiss after ~4s, and clear its `setTimeout` on unmount. The close control MUST be a Lucide `X` icon with `aria-label="Cerrar error"`.

#### Scenario: Auto-dismiss with cleanup

- GIVEN `error` is set
- WHEN the user does not interact for ~4s
- THEN the toast disappears AND `error` becomes `null`
- AND if `page.tsx` unmounts first, the `setTimeout` is cleared (no React warning)

#### Scenario: Manual dismiss

- GIVEN `error` is set
- WHEN the user clicks the close control
- THEN the toast animates out and `error` becomes `null` immediately

### Requirement: Accessibility Primitives

Every icon-only `<button>` MUST have an `aria-label`. Every interactive element MUST expose a `focus-visible:ring-*` outline bound to the `--ui-focus` token.

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

## Success Criteria

`tsc --noEmit`, `next lint`, `next build` all pass; zero emoji in `src/components/*.tsx` and `src/app/page.tsx`; no `any` in `page.tsx`; `useConsensusFeature` removed; all icon-only `<button>`s have `aria-label`; focus-visible ring on every interactive; error toast animates in/out and auto-dismisses after ~4s with no timer leak; DataEditor unselected rows at full opacity; all 5 wizard screens visually consistent.
