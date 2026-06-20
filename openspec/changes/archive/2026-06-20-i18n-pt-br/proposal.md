# Proposal: Internationalize UI (pt-BR primary, es secondary)

## Intent

The SPA is 100% hardcoded in Spanish across 21 components. Portuguese (pt-BR) is the primary audience; Spanish is retained for continuity. Add a lightweight i18n layer so the user picks a locale, every string flows through `t()`, and adding a third language later is a JSON file plus an `<option>`.

## Scope

### In Scope
- Install `i18next` + `react-i18next` + `i18next-browser-languagedetector`
- New `src/i18n/{config.ts,Provider.tsx,LocaleSwitcher.tsx,locales/{pt-BR,es}.json}`
- `src/app/layout.tsx` — drop `lang="es"`, wrap in `<I18nProvider>`
- `src/lib/utils.ts` — locale-aware `formatDistance` / `formatDuration`
- Replace all hardcoded Spanish in `page.tsx` + the 20 listed components
- Persist locale in `localStorage["vrp_locale"]`

### Out of Scope
- `next-intl`, App Router locale routing, server components, RSC
- Console messages, algorithm logs, third language data
- Refactoring `page.tsx` state machine, backend response strings (none exist)

## Capabilities

### New Capabilities
- `localization`: i18n infrastructure — locale JSONs, `I18nProvider`, `LocaleSwitcher`, `t()` contract, `localStorage` persistence, locale-aware formatters.

### Modified Capabilities
- `user-interface`: "Error Toast Lifecycle" hardcodes `aria-label="Cerrar error"` and "Accessibility Primitives" assumes Spanish — both must become locale-aware. Delta specs to follow.

## Approach

1. **Install** `i18next@^23`, `react-i18next@^15`, `i18next-browser-languagedetector@^8` (~12KB gz, MIT, no dev-deps).
2. **Config + Provider** (`src/i18n/config.ts`, `Provider.tsx`): init with `pt-BR` default + `es` fallback, `localStorage` detector under `vrp_locale`, `interpolation.escapeValue: false`. Provider is `"use client"`, calls `i18n.init()` in `useEffect`, gates children render.
3. **Locales** (`src/i18n/locales/{pt-BR,es}.json`): flat key tree, namespaced by component (e.g. `wizard.steps.upload`, `dataEditor.errors.emptyName`). Both files MUST stay structurally identical. Plurals via `_one` / `_other`.
4. **LocaleSwitcher**: dropdown in the wizard header with Lucide `Languages` icon, options `Português (BR)` and `Español`.
5. **Formatters** (`src/lib/utils.ts`): `formatDistance` / `formatDuration` accept an optional locale (default `i18n.language`); units move to a `units.*` namespace per locale.
6. **Missing key fallback**: i18next default — show the key path in dev. No `saveMissing` server.

## Affected Areas

| Area | Impact |
|------|--------|
| `src/i18n/**` | New |
| `package.json` | +3 i18n deps |
| `src/app/layout.tsx` | Drop `lang="es"`, wrap in `<I18nProvider>` |
| `src/app/page.tsx` + 20 components | Spanish → `t()` |
| `src/lib/utils.ts` | Formatters accept locale |
| `openspec/specs/user-interface/spec.md` | Aria-label contract locale-aware |
| `openspec/specs/localization/spec.md` | New capability spec |

## Risks

| Risk | Mitigation |
|------|------------|
| `{count}` / `{day}` interpolation breaks | i18next named placeholders; spec naming convention |
| Pluralization regresses (1 parada vs N) | `_one` / `_other` plurals; manual smoke both locales |
| Locale JSON drift (pt-BR vs es) | Same key set enforced by hand at first; CI check in follow-up |
| First-paint flicker before init | Provider gates render; fallback to bundled pt-BR JSON |
| No test runner — zero regression guard | Manual smoke checklist in tasks.md; `tsc --noEmit` + `next build` only |

## Rollback Plan

Atomic commit per phase (infra → formatters → components). `git revert` restores the all-Spanish build. Orphaned `vrp_locale` entries become harmless — i18next falls back to pt-BR.

## Dependencies

- `i18next@^23` (MIT, ~7KB), `react-i18next@^15` (~3KB), `i18next-browser-languagedetector@^8` (~2KB). All MIT, all runtime deps.

## Success Criteria

- [ ] `tsc --noEmit` + `next lint` + `next build` pass
- [ ] First paint in pt-BR; `es` selectable from header; locale persists via `localStorage["vrp_locale"]`
- [ ] Regex audit: zero hardcoded Spanish UI strings across all 21 touched files
- [ ] `formatDistance(1.2)` → `"1,2 km"` (pt-BR) / `"1.2 km"` (es); pluralization correct in both locales
- [ ] Missing key visibly shows the key path in dev
- [ ] `openspec/specs/localization/spec.md` created; `user-interface` delta merged
