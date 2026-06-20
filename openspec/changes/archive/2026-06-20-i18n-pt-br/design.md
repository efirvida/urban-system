# Design: Internationalize UI (pt-BR primary, es secondary)

## Technical Approach

Wrap the SPA in `<I18nProvider>` at `layout.tsx`, inject `useTranslation()` into 21 client components, and replace every hardcoded Spanish string with `t("namespace.key")`. Locale JSONs already exist at `src/i18n/locales/{pt-BR,es}.json` (structurally identical). Formatters in `src/lib/utils.ts` become locale-aware via an optional `locale` parameter. The change is purely additive to the render tree — zero architecture refactors, zero server-side work.

## Architecture Decisions

### Decision: React-i18next vs next-intl

**Choice**: `i18next` + `react-i18next` + `i18next-browser-languagedetector` (~12KB gz, MIT).

**Alternatives considered**: `next-intl` — requires App Router locale routing, middleware, and server-component boundaries.

**Rationale**: This is a 100% client-side SPA. `next-intl` adds middleware complexity this project doesn't need. The three `i18next` packages are battle-tested, zero-config on the client, and the `useTranslation` hook slots directly into the existing `"use client"` component model.

### Decision: Bundled JSONs vs lazy-loaded

**Choice**: Static `import ptBR from "./locales/pt-BR.json"` in `config.ts`.

**Alternatives considered**: `i18next-http-backend` with `/locales/{{lng}}.json` fetch.

**Rationale**: Both locale files together are ~4KB gzipped. A runtime fetch adds a waterfall and a loading state nobody needs. Static imports mean `i18n.init()` is synchronous after module eval — no async gate except the `useEffect` bootstrap.

### Decision: Gate render on `i18n.isInitialized`

**Choice**: `I18nProvider` returns `null` until `i18n.init()` resolves.

**Alternatives considered**: Render immediately with a Suspense boundary or a loading spinner.

**Rationale**: `i18n.init()` with static resources completes in the same microtask. The gate prevents exactly one frame of untranslated English keys. No spinner UX to build or maintain. The `null` return causes zero layout shift — React reconciles the children tree on the next commit.

### Decision: Formatters accept locale, not call `useTranslation`

**Choice**: `formatDistance(km, locale?)` and `formatDuration(hours, locale?)` with an optional locale string defaulting to `"pt-BR"`.

**Alternatives considered**: Import `i18n` directly inside `utils.ts`, or make formatters hooks.

**Rationale**: `utils.ts` is a plain module, not a React component. Importing `i18n` directly couples formatters to i18next. Passing locale as a parameter keeps the formatter pure and lets components pass `i18n.language` from their own `useTranslation()` scope. Unit words come from `t("units.km")` in the calling component and are passed as suffix strings — no locale JSON import in `utils.ts`.

## Data Flow

```
localStorage["vrp_locale"] (or navigator.language)
        │
        ▼
  config.ts: i18n.init()
        │
        ▼
  Provider.tsx: isInitialized check → <I18nextProvider>
        │
        ▼
  layout.tsx: <html lang={i18n.language}>  ← dynamic via useSyncExternalStore
        │
        ▼
  page.tsx: useTranslation() → t("wizard.steps.upload")
  components/*.tsx: useTranslation() → t("dataEditor.errors.emptyName")
        │
        ▼
  LocaleSwitcher onChange → i18n.changeLanguage("es")
        │                          │
        │                          ▼
        │                    localStorage["vrp_locale"] = "es"
        │                          │
        ▼                          ▼
  All useTranslation() hooks re-render ← i18next event emitter
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Modify | Add `i18next@^23`, `react-i18next@^15`, `i18next-browser-languagedetector@^8` |
| `src/i18n/config.ts` | Exists | `i18n.init()` with pt-BR default, es fallback, localStorage detection |
| `src/i18n/Provider.tsx` | Exists | `"use client"` gate — renders `null` until `i18n.isInitialized` |
| `src/i18n/LocaleSwitcher.tsx` | Exists | `<select>` with Lucide `Languages` icon, pt-BR + es options |
| `src/i18n/locales/pt-BR.json` | Exists | 205 lines, ~150 keys, complete |
| `src/i18n/locales/es.json` | Exists | 205 lines, structurally identical to pt-BR |
| `src/app/layout.tsx` | Modify | Drop `lang="es"`, wrap `<I18nProvider>`, dynamic `lang` from i18n, move metadata keys to `t()` (or keep static — see Open Questions) |
| `src/app/page.tsx` | Modify | Add `useTranslation`, `LocaleSwitcher` in header, replace ~20 strings with `t()` ~40 lines changed |
| `src/lib/utils.ts` | Modify | Add optional `locale` param to `formatDistance`/`formatDuration`, use `Intl.NumberFormat` for decimal separators. ~25 lines |
| `src/components/DataEditor.tsx` | Modify | 16 strings → `t()`. ~30 lines |
| `src/components/ResultsPanel.tsx` | Modify | 18 strings → `t()`. ~35 lines |
| `src/components/ConfigPanel.tsx` | Modify | 16 strings → `t()`. ~30 lines |
| `src/components/DayColumn.tsx` | Modify | 10 strings → `t()`. ~25 lines |
| `src/components/RouteEditor.tsx` | Modify | 6 strings → `t()`. ~15 lines |
| `src/components/ColumnMapper.tsx` | Modify | 6 strings → `t()`. ~15 lines |
| `src/components/FileUpload.tsx` | Modify | 2 strings → `t()`. ~5 lines |
| `src/components/MapPOIActionBar.tsx` | Modify | 8 strings → `t()`. ~20 lines |
| `src/components/OptimizeProgress.tsx` | Modify | 2 strings → `t()`. ~5 lines |
| `src/components/UnreachableWarning.tsx` | Modify | 6 strings → `t()`. ~15 lines |
| `src/components/UnassignedPool.tsx` | Modify | 2 strings → `t()`. ~5 lines |
| `src/components/FloatingUnassignedPanel.tsx` | Modify | 4 strings → `t()`. ~10 lines |
| `src/components/StopItem.tsx` | Modify | 3 strings → `t()`. ~8 lines |
| `src/components/Sidebar.tsx` | Modify | 2 strings → `t()`. ~5 lines |
| `src/components/EditorToolbar.tsx` | Modify | 4 strings → `t()`. ~10 lines |
| `src/components/WizardSteps.tsx` | Modify | Phase labels come from parent → no internal strings (verify) |
| `src/components/RouteMap.tsx` | Verify | No hardcoded UI strings expected — verify only |
| `src/components/LocationMapEditor.tsx` | Verify | No hardcoded UI strings expected — verify only |
| `src/components/MapView.tsx` | Verify | No hardcoded UI strings expected — verify only |
| `src/components/OptimizeButton.tsx` | Verify | No hardcoded UI strings expected — verify only |

## Interfaces / Contracts

```typescript
// src/lib/utils.ts — extended signatures
export function formatDistance(km: number, locale?: string): string;
export function formatDuration(hours: number, locale?: string): string;
// Internal: uses Intl.NumberFormat(locale ?? "pt-BR", { maximumFractionDigits: 1 })
// for decimal → "1,2" (pt-BR) vs "1.2" (es).
// Unit suffixes ("km", "m", "h", "min") are passed by the caller from t("units.km").
```

```typescript
// Every component file pattern
import { useTranslation } from "react-i18next";
// Inside component:
const { t } = useTranslation();
// Replace "Nombre vacío" → t("dataEditor.errors.emptyName")
// Replace aria-label="Cerrar error" → aria-label={t("ariaLabels.closeError")}
```

**Interpolation contract**: Named placeholders `{{count}}`, `{{day}}`, `{{percent}}` in JSON values. Pluralization via `_one` / `_other` suffixes:

```json
"stops_one": "{{count}} parada",
"stops_other": "{{count}} paradas"
```

**Metadata limitation**: `layout.tsx` `export const metadata` executes at module scope before i18n initializes. i18next `t()` returns the key path for `metadata.title`/`metadata.description` in dev and the fallback (pt-BR) in production. This is acceptable because `<head>` metadata is static per build and locale-aware metadata requires `generateMetadata` (server-side, out of scope).

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Build | `tsc --noEmit` + `next lint` + `next build` | CI gate — must pass after every PR |
| Manual | Zero hardcoded Spanish regex audit | `rg '[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{3,}' src/app/page.tsx src/components/ --include='*.tsx'` — review matches |
| Manual | Locale switch persistence | Switch to es, refresh, verify UI in Spanish |
| Manual | Pluralization (1 vs N) | Edit route to 1 stop, verify "1 parada" (es) / "1 parada" (pt-BR); add stops, verify "N paradas" |
| Manual | Decimal separators | `formatDistance(1.234)` → "1,2 km" (pt-BR) / "1.2 km" (es) |
| Manual | Missing key in dev | Temporarily delete a key, verify key path renders, no crash |
| Manual | Dynamic interpolation | Verify `t("dayColumn.day", { day: 3 })` → "Dia 3" / "Día 3" |

> No test runner exists — all verification is manual per project convention.

## Migration / Rollout

No migration required. i18n is additive — the `<I18nProvider>` wraps the existing tree. Rollback: `git revert` the merge commit. Orphaned `vrp_locale` localStorage key is harmless (i18next falls back to pt-BR on next load).

## Implementation Order

**PR 1 — Infrastructure** (~40 lines):
- `package.json`: add 3 i18n deps
- `src/i18n/*`: verify existing files (config, Provider, LocaleSwitcher, JSONs)
- `src/app/layout.tsx`: wrap `<I18nProvider>`, dynamic `<html lang>`, metadata keys

**PR 2 — Formatters + Core Page** (~100 lines):
- `src/lib/utils.ts`: locale-aware `formatDistance`/`formatDuration`
- `src/app/page.tsx`: add `useTranslation`, `<LocaleSwitcher>` to header, replace all hardcoded strings (~20 keys, 40 lines changed)
- Wire `formatDistance(t("units.km"))` call sites

**PR 3 — Components** (~300 lines):
- All 20 `src/components/*.tsx`: add `useTranslation`, replace hardcoded strings (~100 keys total)
- Components to touch: DataEditor, ResultsPanel, ConfigPanel, DayColumn, RouteEditor, ColumnMapper, FileUpload, MapPOIActionBar, OptimizeProgress, UnreachableWarning, UnassignedPool, FloatingUnassignedPanel, StopItem, Sidebar, EditorToolbar
- Components to verify only (no strings): WizardSteps, RouteMap, LocationMapEditor, MapView, OptimizeButton

**PR 4 — Audit** (~0 lines):
- Regex scan: zero hardcoded Spanish/Portuguese UI strings
- Manual smoke: locale switch, persistence, pluralization, decimals
- `tsc --noEmit` + `next lint` + `next build` final pass

## Open Questions

- [ ] **Metadata i18n**: `export const metadata` in `layout.tsx` runs at module scope. Should we keep metadata hardcoded in pt-BR or accept the i18next fallback (pt-BR key path in dev, pt-BR value in prod)? Proposal: keep static pt-BR metadata; dynamic metadata requires `generateMetadata` (out of scope).
- [ ] **`sidebarSubtitle` dynamic strings**: `"${N} de ${M} seleccionadas"` and `"${N} días · ${X} km"` — should these use `t()` interpolation or remain template literals? Proposal: use `t("wizard.subtitle.review", { selected, total })`.
- [ ] **`routingLabel="Rutas optimizadas"` prop**: Is this a prop on `Sidebar` or `ResultsPanel`? If it's JSX text, replace with `t()`. If it's a prop string passed to a child that renders it, both parent and child need the change. Verify in `page.tsx`.
