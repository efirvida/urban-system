# Toast Notifications Specification

## Purpose

Replace `window.alert` and silent `console.error`-only catch handlers with a minimal React toast: a context + fixed-position host. No new design system — the host is a single floating element at the top-right.

## Requirements

### Requirement: Toast context + host

A `ToastProvider` MUST expose a `useToast()` hook returning `{ show: (msg: string, opts?: { kind?: "error" | "info"; durationMs?: number }) => void }`. `<ToastHost>` MUST mount once at the app root and render active toasts at a fixed position (top-right, z-index above the map). Toasts MUST auto-dismiss after ~4s by default; a manual close MUST be available.
(Previously: errors used `window.alert` (`routeExport.ts:886`) or were silently logged via `.catch(console.error)` in `page.tsx`.)

#### Scenario: `window.alert` is gone from `routeExport.ts`

- GIVEN a failing export path
- WHEN the error handler runs
- THEN a toast appears AND `window.alert` is not called (no `window.alert` references in `src/**/*.ts(x)`)

#### Scenario: Silent catch handlers surface to the user

- GIVEN a fetch in `page.tsx` rejects
- WHEN the `.catch` runs
- THEN `useToast().show(err.message, { kind: "error" })` is called AND the legacy `console.error`-only catch is removed

#### Scenario: Toast auto-dismisses

- GIVEN a toast is visible
- WHEN `durationMs` elapses (default 4000) without interaction
- THEN the toast unmounts

#### Scenario: Manual dismiss

- GIVEN a toast is visible
- WHEN the user clicks the close control
- THEN the toast unmounts immediately

### Out of scope

- Rich toast variants (action buttons, undo, swipe-to-dismiss). Only `info` and `error` kinds, single-line message, close button.
- Queuing / deduplication of identical messages.
- Persistence of toasts across page reloads.
