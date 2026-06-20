# Tasks: fix-route-export-report

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~150 (routeExport.ts) + ~80 (i18n) + ~10 (page.tsx) ≈ 240 |
| 400-line budget risk | Low |
| Chained PRs | No — single PR; one revert restores baseline |
| Delivery strategy | single-pr |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

## Phase 1: i18n Namespace (do FIRST)

- [x] 1.1 Add `routeExport` block to `src/i18n/locales/pt-BR.json`: `title`, `subtitle`, `summary`, `days`, `locations`, `totalDistance`, `day: "Dia {{n}}"`, `stops`, `distance`, `duration`, `visits_one: "{{count}} visita"`, `visits_other: "{{count}} visitas"`, `viewInMaps`, `fromPrev`, `cumulative`, `sequence: "#"`, `name`, `summarySheet`, `totalKm`, `totalHours`, `distanceFromPrev`, `cumulativeKm`, `cumulativeTime`, `home`, `km`, `hour`, `min`, `page`
- [x] 1.2 Mirror keys in `src/i18n/locales/es.json` (Spanish); verify parity with `jq` key-count diff
- [x] 1.3 Add `export.exportError` to both files ("Erro ao gerar DOCX" / "Error al generar DOCX")

## Phase 2: routeExport.ts Core Refactor (T2 + T8)

- [x] 2.1 Add `import i18n from "@/i18n/config"`; `const lng = options.locale || i18n.language` at top of each generator
- [x] 2.2 Replace every `l.*` with `t("routeExport.*", { lng })` for all 1.1 keys; `visits(n)` → `t("routeExport.visits", { count: n, lng })`; `day(n)` → `t("routeExport.day", { n, lng })`
- [x] 2.3 Delete `labels()` (70–104) and `fmtDist()`; call `formatDistance()` / `formatDuration()` directly
- [x] 2.4 `locale = "es"` → `locale = ""`; drop dead `isES ? "#" : "#"`; `cleanFileName()` locale-neutral ("route-plan" fallback)

## Phase 3: Format Fixes

- [x] 3.1 (T6 HTML) `<html lang="${i18n.language}">`; body `font-size: 14px` → `15px`; add `@media print { @page { margin: 1.5cm; } .day-card { break-inside: avoid; } }`
- [x] 3.2 (T4 PDF) Page-break guard `y > 250` → `y > 200`; summary height 22 → 30mm; header→link 1 → 4mm; add `pageBreak: "auto"`, `rowPageBreak: "avoid"`, `alternateRowStyles: true`; alt-row shade; `doc.setLanguage(...)`; footer uses `t("routeExport.page")`
- [x] 3.3 (T3 DOCX) Add `styles: { characterStyles: [{ id: "Hyperlink", name: "Hyperlink", basedOn: "DefaultParagraphFont", run: { color: "0563C1", underline: { type: "single" } } }] }` to `DocxDocument`; day `HEADING_1` → `HEADING_2`; every `TableCell` gets `borders: { top/bottom/left/right: { style: BorderStyle.SINGLE, size: 1, color: "auto" } }`; summary `width: { size: 100, type: WidthType.PERCENTAGE }`
- [x] 3.4 (T5 XLSX) `ws["!freeze"] = { ySplit: 3, topLeftCell: "A4" }`; `ws["!autofilter"] = { ref: "A4:E{n}" }`; move maps link to col F; `""` → `"—"`; `z: "0.00"` on km cells; link `s: { font: { color: { rgb: "0563C1" }, underline: true } }` + `l: { Target, Tooltip }`

## Phase 4: Error Handling

- [x] 4.1 (T7) In dispatcher line 779 replace `.catch(console.error)` with `.catch(() => window.alert(t("export.exportError", { lng })))`

## Phase 5: Quality Gates

- [x] 5.1 `npm run type-check && npm run lint && npm run build` — fix errors
- [x] 5.2 Manual: pt-BR HTML lang+labels; 20-day PDF (no overflow, "Página N / Total"); DOCX outline (Resumo H1, Dia N H2, borders, link); XLSX (frozen, autofilter, link)
- [x] 5.3 Edge: `locale: "fr-FR"` → pt-BR fallback; single-stop day; empty day; 80-char name
