# Delta for Localization

## ADDED Requirements

### Requirement: I18n Infrastructure

The system MUST initialize `i18next` with `react-i18next` and `i18next-browser-languagedetector`. The default language MUST be `pt-BR` and the fallback language MUST be `es`. `interpolation.escapeValue` MUST be `false` (React already escapes).

#### Scenario: First paint in pt-BR

- GIVEN a fresh user with no `vrp_locale` entry in `localStorage`
- WHEN the app loads
- THEN the UI renders in Portuguese (pt-BR)
- AND no English fallback strings are visible

### Requirement: Locale Persistence

The system MUST persist the selected locale under the `localStorage` key `vrp_locale`. The key MUST survive a page refresh. Orphaned or invalid values MUST fall back to `pt-BR`.

#### Scenario: Locale persists across refresh

- GIVEN the user picked `es` from the LocaleSwitcher
- WHEN the user refreshes the page
- THEN `i18n.language === "es"`
- AND the UI renders in Spanish

### Requirement: Locale Switcher

The system MUST expose a `LocaleSwitcher` control in the wizard header that toggles between `pt-BR` and `es`. The control MUST use a Lucide `Languages` icon. Each option MUST be labeled in its own language.

#### Scenario: User switches to Spanish

- GIVEN the app is in pt-BR
- WHEN the user clicks the switcher and picks "Español"
- THEN `i18n.changeLanguage("es")` fires
- AND the visible UI updates without a full page reload

### Requirement: Translation Contract

All user-facing strings in `src/app/page.tsx`, `src/app/layout.tsx`, and every file under `src/components/` MUST flow through the `t()` function. Zero hardcoded Spanish OR Portuguese strings MAY remain in user-facing markup.

#### Scenario: Audit finds zero hardcoded UI strings

- GIVEN the implementation is complete
- WHEN a regex audit scans the 22 touched files
- THEN zero matches for hardcoded user-facing strings are found
- AND code comments, console logs, and dynamic user data (e.g. POI names) are excluded

### Requirement: Missing Key Handling

In development (`NODE_ENV !== "production"`), a missing translation MUST render the key path so it is obvious in the UI. In production, a missing key MUST fall back to the `pt-BR` value. The system MUST NOT crash on a missing key.

#### Scenario: Missing key in dev

- GIVEN a component calls `t("foo.bar")` and `foo.bar` is absent
- WHEN the component renders in development mode
- THEN the literal text `foo.bar` is shown
- AND no runtime error is thrown

### Requirement: Number and Unit Formatting

`formatDistance` and `formatDuration` in `src/lib/utils.ts` MUST accept an optional `locale` parameter (defaulting to `i18n.language`). Decimal separators MUST follow the locale (`1,2 km` for `pt-BR`, `1.2 km` for `es`). Unit words (`km`, `m`, `h`, `min`, `visitas`, `paradas`) MUST come from the locale JSON under the `units.*` namespace.

#### Scenario: Distance formats per locale

- GIVEN `formatDistance(1.234)`
- WHEN locale is `pt-BR`
- THEN the result is `"1,2 km"`
- AND when locale is `es`, the result is `"1.2 km"`

### Requirement: Pluralization

Count-dependent strings MUST use the `react-i18next` `_one` / `_other` pluralization convention. The system MUST NOT hardcode the `count !== 1 ? "s" : ""` plural hack.

#### Scenario: One stop vs many

- GIVEN a day with 1 stop
- WHEN `t("dayColumn.stopsCount", { count: 1 })` is called
- THEN the result uses the `_one` variant
- AND with `count: 5`, the `_other` variant is used

### Requirement: Locale JSON Structural Parity

`src/i18n/locales/pt-BR.json` and `src/i18n/locales/es.json` MUST have identical key sets. `pt-BR` is the primary locale and MUST be complete. `es` is secondary and MAY fall back to `pt-BR` for any missing values during bootstrap.

#### Scenario: Key set parity

- GIVEN both locale files exist
- WHEN the key sets are diffed
- THEN every key in `pt-BR.json` has a matching key in `es.json`
- AND vice versa

### Requirement: Provider Gates Render

The `I18nProvider` component MUST wrap the app. It MUST call `i18n.init()` in a `useEffect`. Children MUST NOT render until `i18n.isInitialized === true`. The provider MUST be marked `"use client"`.

#### Scenario: No flicker before init

- GIVEN the I18nProvider is rendered
- WHEN `i18n.init()` is in flight
- THEN the first paint shows the pt-BR bundled fallback
- AND no untranslated English keys flash on screen
