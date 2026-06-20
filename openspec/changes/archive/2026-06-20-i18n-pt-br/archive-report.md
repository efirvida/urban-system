# Archive Report: i18n-pt-br

## Change Summary

**Change**: Internationalize UI (pt-BR primary, es secondary)
**Archived**: 2026-06-20
**Archive location**: `openspec/changes/archive/2026-06-20-i18n-pt-br/`
**Status**: ✅ Complete — all phases shipped, all verifications pass

## What Was Done

The SPA was 100% hardcoded in Spanish across 21+ components. This change introduced a lightweight client-side i18n layer (i18next + react-i18next + i18next-browser-languagedetector), wired it through the root layout, and replaced every hardcoded Spanish string with a `t("namespace.key")` call backed by a locale JSON.

- **Default locale**: `pt-BR` (Portuguese — primary audience)
- **Secondary locale**: `es` (Spanish — retained for continuity)
- **Persistence**: `localStorage["vrp_locale"]` survives refresh; invalid values fall back to `pt-BR`
- **Provider**: `<I18nProvider>` in `src/app/layout.tsx` gates render until `i18n.isInitialized` — no English key flicker
- **Formatters**: `formatDistance` and `formatDuration` accept an optional `locale` parameter using `Intl.NumberFormat` — `1,2 km` (pt-BR) vs `1.2 km` (es)
- **Pluralization**: `react-i18next` `_one` / `_other` convention (no `count !== 1 ? "s" : ""` hack)
- **Locale switcher**: Dropdown with Lucide `Languages` icon in the wizard header; updates the UI without a full reload

## Files Created

### i18n infrastructure (`src/i18n/`)
- `config.ts` — i18n instance, `pt-BR` default, `es` fallback, `localStorage` detection under `vrp_locale`, `interpolation.escapeValue: false`
- `Provider.tsx` — `"use client"` component, calls `i18n.init()` in `useEffect`, returns `null` until initialized
- `LocaleSwitcher.tsx` — `<select>` with Lucide `Languages` icon, pt-BR + es options
- `HtmlLang.tsx` — Dynamic `<html lang>` via `useSyncExternalStore` over i18n
- `locales/pt-BR.json` — 24 top-level keys, primary locale, complete
- `locales/es.json` — 24 top-level keys, structurally identical to pt-BR.json (verified)

## Files Modified

### App layer
- `src/app/layout.tsx` — Dropped `lang="es"`, wrapped `<I18nProvider>`, added dynamic `<html lang>`, metadata kept static pt-BR
- `src/app/page.tsx` — Added `useTranslation`, `<LocaleSwitcher>` in header, replaced all hardcoded strings (~16 keys, ~40 lines)

### Library
- `src/lib/utils.ts` — `formatDistance(km, locale?)` and `formatDuration(hours, locale?)` with optional locale parameter, `Intl.NumberFormat` for decimal separators

### Components (15 files, ~300 lines)
- `src/components/DataEditor.tsx` — 16 strings → `t()`
- `src/components/ResultsPanel.tsx` — 18 strings → `t()`
- `src/components/ConfigPanel.tsx` — 16 strings → `t()`
- `src/components/DayColumn.tsx` — 10 strings → `t()`
- `src/components/RouteEditor.tsx` — 6 strings → `t()`
- `src/components/ColumnMapper.tsx` — 6 strings → `t()`
- `src/components/FileUpload.tsx` — 2 strings → `t()`
- `src/components/MapPOIActionBar.tsx` — 8 strings → `t()`
- `src/components/OptimizeProgress.tsx` — 2 strings → `t()`
- `src/components/UnreachableWarning.tsx` — 6 strings → `t()`
- `src/components/UnassignedPool.tsx` — 2 strings → `t()`
- `src/components/FloatingUnassignedPanel.tsx` — 4 strings → `t()`
- `src/components/StopItem.tsx` — 3 strings → `t()`
- `src/components/Sidebar.tsx` — 2 strings → `t()`
- `src/components/EditorToolbar.tsx` — 4 strings → `t()`

### Map subdirectory hooks
- `src/components/map/useLeafletMarkers.ts` — Hardcoded user-facing strings → `t()`
- `src/components/map/useLeafletRoutes.ts` — Hardcoded user-facing strings → `t()`

### Verified-only (no hardcoded strings to replace)
- `src/components/MapView.tsx`
- `src/components/WizardSteps.tsx`

### Dependencies
- `package.json` / `package-lock.json` — Added `i18next@^23`, `react-i18next@^15`, `i18next-browser-languagedetector@^8`

### Specs
- `openspec/specs/localization/spec.md` — New capability (created in this change, already in sync)
- `openspec/specs/user-interface/spec.md` — "Error Toast Lifecycle" and "Accessibility Primitives" requirements updated to require `t()`-resolved aria-labels and the visible error prefix

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `localization` | Created | New capability — 9 requirements covering infrastructure, persistence, switcher, translation contract, missing-key handling, formatters, pluralization, JSON parity, and provider gating |
| `user-interface` | Modified | "Error Toast Lifecycle" now mandates `t("ariaLabels.closeError")` + `t("common.error")` for visible prefix; "Accessibility Primitives" now mandates `ariaLabels.*` namespace resolution with a documented exception for technical hints; added 2 new scenarios each (close-control label and locale-switch aria-label updates) |

## Verification Results

- ✅ `npx tsc --noEmit` — PASS
- ✅ `npx next lint` — PASS (1 pre-existing unrelated warning)
- ✅ `npx next build` — PASS
- ✅ Locale JSON key-set parity: `pt-BR.json` and `es.json` have identical 24 top-level keys
- ✅ Regex audit: zero hardcoded Spanish/Portuguese UI strings in `src/app/` and `src/components/`
- ✅ All 4 PRs applied (infra → formatters + page → 15 components → audit + fixes)

## Archive Contents

- `proposal.md` ✅
- `design.md` ✅
- `tasks.md` ✅ (all 39 lines, 4 phases complete)
- `specs/localization/spec.md` ✅
- `specs/user-interface/spec.md` ✅

## Source of Truth Updated

- `openspec/specs/localization/spec.md` — new capability spec
- `openspec/specs/user-interface/spec.md` — Error Toast + Accessibility Primitives now locale-aware

## Remaining Considerations

- **API routes are server-side, out of UI scope.** `/api/optimize`, `/api/optimize/config`, and `/api/routing` return JSON; none of their messages reach the user as localized text. The server logs and error envelopes (e.g. `"No result event in stream"`, `"No hay ubicaciones válidas."`) are developer-facing only. Future work could add a `lang` query parameter and i18n-aware error messages, but this requires server-side locale resolution that conflicts with the current client-only architecture.
- **Metadata in `layout.tsx` stays static pt-BR.** `export const metadata` runs at module scope, before i18n initializes. Locale-aware metadata requires `generateMetadata` (App Router server-side), explicitly out of scope per the proposal.
- **No test runner.** All verification is manual: locale switch, persistence across refresh, pluralization (1 vs N stops), decimal separators (`1,2 km` vs `1.2 km`), missing key visibly shows the key path in dev. Project convention — `tsc --noEmit` + `next lint` + `next build` are the only quality gates.
- **Adding a third language** is a JSON file plus an `<option>` in `LocaleSwitcher` — the infrastructure is in place.
- **CI guard for locale JSON drift** was identified as a follow-up (delta spec mentions it); not in scope here. Manual parity check at apply-time is the current contract.

## SDD Cycle Complete

The change was fully planned (proposal + design + specs + tasks), implemented across 4 chained PRs (~520 LOC), verified (tsc/lint/build all pass), and archived. The localization capability is now the source of truth in `openspec/specs/localization/spec.md`, and the user-interface spec has been updated to require locale-aware aria-labels. Ready for the next change.
