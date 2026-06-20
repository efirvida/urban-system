# Tasks: Internationalize UI (pt-BR primary, es secondary)

## Review Workload Forecast

Total ~520 LOC. Budget 800 (D2). Risk Low. Chained PRs Yes (C3). Strategy `stacked-to-main`.

### Work Units: PR 1 deps+layout (~40) | PR 2 formatters+page (~100) | PR 3 15 components (~300) | PR 4 audit+fix (~80)

## Phase 1: Infrastructure (PR 1)

- [x] 1.1 `npm install i18next@^23 react-i18next@^15 i18next-browser-languagedetector@^8`
- [x] 1.2 `src/app/layout.tsx`: wrap in `<I18nProvider>`, dynamic `<html lang>`, metadata static pt-BR
- [x] 1.3 Verify pre-existing `src/i18n/*` files compile
- [x] 1.4 Verify: `npm run type-check`, `next build`

## Phase 2: Formatters + Core Page (PR 2)

- [x] 2.1 `src/lib/utils.ts`: locale-aware `formatDistance`/`formatDuration`
- [x] 2.2 `src/app/page.tsx`: `useTranslation`, `<LocaleSwitcher>`, replace 16+ hardcoded strings
- [x] 2.3 Pass `i18n.language` to format calls
- [x] 2.4 Verify: type-check, lint, build

## Phase 3: All Components (PR 3)

- [x] 3.1-3.15 All 15 components internationalized
- [x] 3.16 Verify: type-check, lint, build

## Phase 4: Final Audit & Fixes

- [x] 4.1 Regex audit for remaining hardcoded Spanish — **FIXED**
- [x] 4.2 Remaining strings in FileUpload, ConfigPanel, EditorToolbar, MapView, OptimizeProgress, map subdir, LocaleSwitcher, UnassignedPool
- [x] 4.3 `npx tsc --noEmit` — PASS
- [x] 4.4 `npx next lint` — PASS (1 pre-existing unrelated warning)
- [x] 4.5 `npx next build` — PASS
- [x] 4.6 Translation contract: pt-BR.json and es.json have identical key sets (ALL keys match)

### Summary

All 4 PRs applied. ~520 lines changed across 20+ files. `tsc --noEmit`, `next lint`, `next build` all PASS. Infra: `i18next@^23` + `react-i18next@^15` + `i18next-browser-languagedetector@^8`. Locale: pt-BR primary, es secondary, persisted in localStorage. Zero hardcoded Spanish UI strings remain in src/app/ and src/components/.
