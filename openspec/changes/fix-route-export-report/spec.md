# Delta for `fix-route-export-report`

## Capabilities

| Capability | Type | Source |
|---|---|---|
| `route-export` | NEW | `src/lib/routeExport.ts` — locale-aware export to 4 formats |
| `localization` | MODIFIED | `src/i18n/locales/{pt-BR,es}.json` — gain `routeExport.*` namespace |

---

## ADDED Requirements — `route-export`

| ID | Requirement | Format |
|---|---|---|
| R1 | The system MUST render every label via `t("routeExport.*", { lng })`; default `pt-BR`; unsupported locales fall back to `pt-BR`. | All |
| R2 | Each day MUST expose a clickable Google Maps directions link, ordered by `sequence`. | All |
| R3 | Each export MUST include a summary block (days, locations, distance) and a per-day stop table. | All |
| R4 | The home stop MUST be marked with the `routeExport.home` text label, NOT by emoji alone. | All |
| R5 | HTML MUST be self-contained; `<html lang>` MUST equal `i18n.language`; print-friendly with `@page { margin: 1.5cm }` and `break-inside: avoid` on day cards. | HTML |
| R6 | HTML body font MUST be 15px; day cards MUST NOT split mid-row when printed. | HTML |
| R7 | PDF MUST break to a new page at `y > 200mm`; `jspdf-autotable` MUST set `pageBreak: "auto"`, `rowPageBreak: "avoid"`, `alternateRowStyles`. | PDF |
| R8 | PDF maps link MUST use `doc.textWithLink`; footer MUST show `Página N / Total` in the active locale. | PDF |
| R9 | PDF tables MUST have header shading `#2563eb` and alternating row colors. | PDF |
| R10 | DOCX MUST declare a `Hyperlink` character style in `Document.styles`. | DOCX |
| R11 | Every DOCX `TableCell` MUST have `BorderStyle.SINGLE` borders on all four sides. | DOCX |
| R12 | DOCX MUST use `HEADING_1` for `Resumo` and `HEADING_2` for each `Dia N`; a `pageBreakBefore` MUST separate days. | DOCX |
| R13 | XLSX MUST freeze the header row (`!freeze`) and apply `autofilter` to the data range (`!autofilter`). | XLSX |
| R14 | XLSX MUST define `!cols` widths and a styled blue-underlined maps-link cell with `cell.l.Target`. | XLSX |
| R15 | All 4 formats MUST handle empty days, single-stop days, zero-distance legs (→ `—`), 20+ days, and long names (≥80 chars). | All |

---

## Scenarios

### Cross-cutting (all formats)

#### Scenario: pt-BR user exports
- GIVEN `i18n.language === "pt-BR"`
- WHEN any export runs
- THEN every visible label reads in Portuguese
- AND no English or Spanish strings appear

#### Scenario: Unsupported locale fallback
- GIVEN `locale = "fr-FR"` is passed
- WHEN any export builds
- THEN `pt-BR` is used as fallback
- AND no runtime error is thrown

#### Scenario: Maps link present
- GIVEN any day with ≥1 stop
- WHEN the export generates
- THEN a "View in Google Maps" link appears for that day
- AND the URL starts with `https://www.google.com/maps/dir/`

#### Scenario: Home row indicator
- GIVEN a day that starts and ends at home
- WHEN the table renders
- THEN the first and last rows display the `routeExport.home` text

### HTML

#### Scenario: HTML opens offline
- GIVEN the HTML file is saved locally
- WHEN opened with no internet
- THEN the report renders identically
- AND `<html lang="pt-BR">` matches `i18n.language` exactly

#### Scenario: Print page breaks
- GIVEN a 20-day export
- WHEN the user prints to PDF from the browser
- THEN each day card stays on one page or splits cleanly

### PDF

#### Scenario: 20-day pagination
- GIVEN 20 days of routes
- WHEN the PDF generates
- THEN no row is split mid-cell
- AND every page footer shows `Página N / Total`

#### Scenario: Clickable maps link
- GIVEN a day with stops
- WHEN the PDF opens in a viewer
- THEN clicking the maps text opens the directions URL in a browser

### DOCX

#### Scenario: Word outline view
- GIVEN the DOCX opens in Word
- WHEN the user toggles outline view
- THEN `Resumo` is at H1, each `Dia N` is at H2
- AND all tables show visible black borders

#### Scenario: Maps hyperlink in Word
- GIVEN the DOCX opens
- WHEN the user Ctrl-clicks the "View in Google Maps" text
- THEN the browser opens the directions URL via the `Hyperlink` style

### XLSX

#### Scenario: Frozen header and autofilter
- GIVEN the XLSX opens in Excel
- WHEN the user scrolls down
- THEN the header row stays pinned
- AND the autofilter dropdowns are available on the data range

#### Scenario: Maps link cell
- GIVEN a day sheet
- WHEN the user clicks the maps link cell
- THEN the browser opens the directions URL

### Edge cases

#### Scenario: Single-stop day
- GIVEN a day with 1 visit
- WHEN the export runs
- THEN the day still appears with its summary line
- AND the table has exactly 2 rows (home + 1 stop)

#### Scenario: Empty day
- GIVEN a day whose only stops are home (start and end)
- WHEN the export runs
- THEN the day still appears with `0 visitas` and 0 distance
- AND no table-row crash occurs

---

## MODIFIED Requirements — `localization`

### Requirement: `routeExport` Namespace Parity

(Previously: locale JSONs covered `wizard.*`, `resultsPanel.*`, `dayColumn.*`, etc. The `routeExport.*` namespace was absent and `routeExport.ts` used a local `labels(locale)` helper that only supported `es` + `en`.)

The locale JSONs (`src/i18n/locales/pt-BR.json`, `src/i18n/locales/es.json`) MUST contain a `routeExport.*` namespace with identical key sets. `pt-BR` is the source of truth. The namespace MUST include at least: `title`, `subtitle`, `summary`, `days`, `locations`, `totalDistance`, `day`, `stops`, `distance`, `duration`, `viewInMaps`, `fromPrev`, `cumulative`, `sequence`, `name`, `summarySheet`, `totalKm`, `totalHours`, `distanceFromPrev`, `cumulativeKm`, `cumulativeTime`, `home`, `km`, `hour`, `min`, `page`, and `visits_one` / `visits_other`.

#### Scenario: Key set parity

- GIVEN both locale files are updated
- WHEN key sets are diffed with `jq`
- THEN every key in `pt-BR.json` has a matching key in `es.json`
- AND no key in `es.json` is absent from `pt-BR.json`

---

## Success Criteria

- [ ] `tsc --noEmit`, `next lint`, `next build` all pass.
- [ ] All 4 formats in `pt-BR` show Portuguese; HTML `<html lang>` matches `i18n.language` exactly.
- [ ] DOCX: borders visible, `Resumo` H1 + `Dia N` H2 outline, blue-underlined maps link.
- [ ] PDF with 20 days does not overflow A4; XLSX: frozen header, autofilter, styled clickable maps link.
- [ ] `route-export` spec created; `localization` delta merged; `routeExport.*` key sets identical in both locales.
