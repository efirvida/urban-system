# Design: Fix Route Export Reports

## Technical Approach

Replace inline `labels(locale)` with `i18next` `t()` calls under a new `routeExport` namespace. Fix structural bugs in all 4 formats: HTML `<html lang>` + print CSS, PDF page-break guard + autotable config, DOCX border/style/heading hierarchy, XLSX freeze/autofilter/link cell. Locale JSONs gain parity under `routeExport.*`. The monolithic `routeExport.ts` stays as a single module — splitting per-format adds indirection without benefit at this scale (785 lines, 4 tightly-related generators sharing `ExportOptions`).

## Architecture Decisions

### Decision: i18n strategy — `t("routeExport.*", { lng })` over inline `labels()`

**Choice**: Replace the `labels(locale)` helper with direct `i18next` `t()` calls using a new `routeExport` namespace.
**Alternatives**: Pass a `t` function down (couples callers to i18n API); keep `labels()` but add pt-BR (duplicates i18n infrastructure already live in the app).
**Rationale**: `i18next` is already initialized with language detection, fallback `pt-BR`, pluralization (`_one`/`_other`), and interpolation. The `labels()` function was a stopgap that bypassed all of that. `routeExport.ts` runs client-side only, so `import i18n from "@/i18n/config"` works — no SSR guard needed. HTML `<html lang>` reads `i18n.language` directly instead of the ternary `locale.startsWith("es") ? "es" : "pt"`.

### Decision: Keep `routeExport.ts` monolithic

**Choice**: Single module, 4 generator functions + 1 dispatcher.
**Alternatives**: Split into `src/lib/export/{html,pdf,docx,xlsx}.ts` + shared helpers.
**Rationale**: 785 lines with tight coupling to `ExportOptions` and `DayRoute`. Splitting would scatter the shared `googleMapsUrl()`, `rawKm()`, `rawHours()` helpers and require an additional `ExportContext` interface. The module boundaries are already clean — each generator is a pure function of `ExportOptions`. Split only if any format exceeds ~300 lines standalone.

### Decision: `routeExport` namespace in existing locale JSONs

**Choice**: Add `routeExport: { … }` key to `pt-BR.json` and `es.json` (existing `defaultNS: "translation"`).
**Alternatives**: Separate JSON file per namespace loaded via `i18n.addResourceBundle`; custom namespace with `ns: ["translation", "routeExport"]`.
**Rationale**: The app uses a single `translation` default namespace with flat JSON keys (`wizard.*`, `resultsPanel.*`, etc.). Adding `routeExport.*` follows the established convention. No need for multi-namespace loading — `t("routeExport.title")` resolves correctly with `returnObjects: false`. See `src/i18n/config.ts` for current init.

## Data Flow

```
page.tsx (i18n.language)
    │
    ├── downloadRoutePlan(options, "html")
    │       └── generateRoutePlanHtml(options)
    │               ├── t("routeExport.*")  ──→ i18n config (fallback pt-BR)
    │               ├── googleMapsUrl(stops)  ──→ "https://www.google.com/maps/dir/…"
    │               └── return HTML string  ──→ Blob → download link
    │
    ├── downloadRoutePlan(options, "pdf")
    │       └── generateRoutePlanPdf(options)
    │               ├── t("routeExport.*")
    │               ├── autotable with pageBreak/rowPageBreak/alternateRowStyles
    │               ├── didDrawPage footer (Página N / Total)
    │               └── return jsPDF → doc.save()
    │
    ├── downloadRoutePlan(options, "docx")     ← async (Promise)
    │       └── generateRoutePlanDocx(options)
    │               ├── t("routeExport.*")
    │               ├── Document.styles with Hyperlink character style
    │               ├── TableCell borders, HEADING_1/HEADING_2 hierarchy
    │               └── Packer.toBlob(doc) → download link
    │
    └── downloadRoutePlan(options, "xlsx")
            └── generateRoutePlanXlsx(options)
                    ├── t("routeExport.*")
                    ├── ws["!freeze"], ws["!autofilter"], styled link cell
                    └── XLSX.writeFile(wb, …)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/routeExport.ts` | Modify | Replace `labels()` → `t("routeExport.*")`; fix HTML `<html lang>`, print CSS (15px body, `@page 1.5cm`, `break-inside: avoid`); fix PDF page-break (`250`→`200mm`), autotable `pageBreak:"auto"`/`rowPageBreak:"avoid"`/`alternateRowStyles`; fix DOCX `Hyperlink` style, `BorderStyle.SINGLE` on all `TableCell`, `HEADING_2` for day headers, `pageBreakBefore` on days 2+; fix XLSX `!freeze`/`!autofilter`/blue-underline link cell `{ font: { underline: true, color: "0563C1" } }` + `l.Target` in dedicated row |
| `src/i18n/locales/pt-BR.json` | Modify | Add `routeExport: { title, subtitle, summary, days, locations, totalDistance, day, stops, distance, duration, visits_one, visits_other, viewInMaps, fromPrev, cumulative, sequence, name, summarySheet, totalKm, totalHours, distanceFromPrev, cumulativeKm, cumulativeTime, home, km, hour, min, page }` |
| `src/i18n/locales/es.json` | Modify | Add identical `routeExport.*` key set with Spanish translations. `pt-BR` is source of truth. |
| `src/app/page.tsx` | Modify | Pass `locale: i18n.language` into all 4 `downloadRoutePlan()` calls (already done). Remove `labels()` dependency awareness — no code changes needed here. |
| `openspec/specs/route-export/spec.md` | Create | New capability spec. |
| `openspec/specs/localization/spec.md` | Modify | Delta: add `routeExport.*` namespace parity requirement. |

## Interfaces / Contracts

### ExportOptions (unchanged signature — locale flows from page.tsx)

```ts
export interface ExportOptions {
  days: DayRoute[];
  totalDistance: number;
  totalDays: number;
  totalLocations: number;
  fileName?: string;
  locale?: string;  // i18n.language from page.tsx → passed to t()
}
```

### routeExport namespace keys (pt-BR source of truth)

```
routeExport.title              → "Relatório de Rotas"
routeExport.subtitle           → "Exportado em"
routeExport.summary            → "Resumo"
routeExport.days               → "Dias"
routeExport.locations          → "Localizações"
routeExport.totalDistance      → "Distância total"
routeExport.day                → "Dia {{n}}"
routeExport.stops              → "Paradas"
routeExport.distance           → "Distância"
routeExport.duration           → "Duração"
routeExport.visits_one         → "{{count}} visita"
routeExport.visits_other       → "{{count}} visitas"
routeExport.viewInMaps         → "Ver no Google Maps"
routeExport.fromPrev           → "Desde anterior"
routeExport.cumulative         → "Acumulado"
routeExport.sequence           → "#"
routeExport.name               → "Nome"
routeExport.summarySheet       → "Resumo"
routeExport.totalKm            → "Total km"
routeExport.totalHours         → "Total horas"
routeExport.distanceFromPrev   → "Dist. desde anterior (km)"
routeExport.cumulativeKm       → "Dist. acumulada (km)"
routeExport.cumulativeTime     → "Tempo acumulado (horas)"
routeExport.home               → "Casa"
routeExport.km                 → "km"
routeExport.hour               → "h"
routeExport.min                → "min"
routeExport.page               → "Página"
```

Pluralization uses i18next `_one`/`_other` suffixes and `t("routeExport.visits", { count: n })` calls.

## Format Design Details

### HTML

- `<html lang={i18n.language}>` — no more locale.startsWith ternary
- Body font: `15px` (14px → 15px)
- Print: `@page { margin: 1.5cm }`, day cards keep `break-inside: avoid`
- No structural changes — template is sound, only labels + lang + font-size

### PDF

- Page break guard: `y > 200` (was `250`, caused overflow near bottom)
- `autoTable` options: `pageBreak: "auto"`, `rowPageBreak: "avoid"`, `alternateRowStyles: true`
- Header: `#2563eb` background, white text, bold, 8pt
- Footer: `didDrawPage` renders `t("routeExport.page") N / Total` centered at y=290
- Maps link: `doc.textWithLink()` with blue color `(37, 99, 235)` below day header

### DOCX

- `Document.styles` declares a `Hyperlink` character style via `Styles.createCharacterStyle("Hyperlink", { basedOn: "Default", run: { color: "0563C1", underline: { type: "single" } } })`
- Every `TableCell`: `borders: { top: { style: BorderStyle.SINGLE, size: 1 }, bottom: …, left: …, right: … }`
- Heading hierarchy: `Resumo` = `HEADING_1`, each `Dia N` = `HEADING_2`
- `pageBreakBefore: true` on every day section except the first
- ExternalHyperlink wraps `l.viewInMaps` text with `style: "Hyperlink"`

### XLSX

- Summary sheet: bold title, col widths `[{wch: 24}, {wch: 12}]`
- Per-day sheets:
  - `!freeze`: `{ xSplit: 0, ySplit: 3, topLeftCell: "A4", activePane: "bottomLeft" }` (freeze header row 3)
  - `!autofilter`: `{ from: { r: 2, c: 0 }, to: { r: lastDataRow, c: 4 } }`
  - Link cell: `ws[cell].l = { Target: mapsUrl, Tooltip: l.viewInMaps }` with `s: { font: { color: { rgb: "0563C1" }, underline: true } }`
  - `!cols`: `[{wch: 6}, {wch: 40}, {wch: 22}, {wch: 22}, {wch: 22}]`

## Error Handling

DOCX generator is async (`Packer.toBlob()`). Current: `downloadRoutePlanDocx(options).catch(console.error)`.  

**Improvement**: The DOCX dispatcher in `downloadRoutePlan` should catch and surface errors to the user via a lightweight toast/alert pattern. Since `page.tsx` already imports `downloadRoutePlan` and the download is triggered from a click handler, the simplest approach is:

```ts
case "docx":
  downloadRoutePlanDocx(options).catch(() => {
    // Use existing export.exportDone key or a new error key
    alert("Erro ao gerar DOCX. Tente novamente.");
  });
  break;
```

No new dependency — `alert()` is sufficient for an export that fires on user click. Future improvement: toast notification system.

## Testing Strategy

No test runner exists. Manual verification checklist:

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Visual per format | HTML: open in browser, check `<html lang>`, print preview page breaks | 5-day fixture, pt-BR + es |
| Visual per format | PDF: open, verify page breaks, footer, clickable link | 20-day fixture |
| Visual per format | DOCX: open in Word, verify borders, outline view, Ctrl+click link | 5-day fixture |
| Visual per format | XLSX: open in Excel, verify freeze, autofilter, click link | 5-day fixture |
| Edge cases | Single-stop day, empty day, zero-distance, 20+ day names, 80-char names | Per-format manual pass |
| Locale fallback | Pass `fr-FR` → expect `pt-BR` labels | All 4 formats |
| Quality gates | `tsc --noEmit`, `next lint`, `next build` | After all changes |

## Migration / Rollout

No migration required. One atomic commit per format group + one for locale JSONs. `git revert` returns to current state. Locale additions are additive — no existing keys are removed.

## Open Questions

- [ ] Should `alert()` for DOCX failure use the `routeExport.*` namespace (needs `t()` import in non-React context) or a plain string? Plain string preferred — `alert()` is not localized.
- [ ] DOCX `Hyperlink` character style: needs verification with `docx` v9.7.1 API (`Styles.createCharacterStyle` exists but exact shape may differ from `DefaultStylesFactory`).
