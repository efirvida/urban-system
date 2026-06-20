# Proposal: Fix Route Export Reports (HTML / PDF / DOCX / XLSX)

## Intent

The SPA has no server-side persistence — the exported report IS the deliverable users share. `src/lib/routeExport.ts` produces 4 formats, but the output is broken: all 4 show English to Portuguese users (default `pt-BR` per `localization` spec), DOCX tables render borderless, Word's outline is flat, PDF tables overflow A4, XLSX is missing freeze panes and autofilter. Reports must look professional in pt-BR and es.

## Scope

### In Scope
- `src/lib/routeExport.ts` — `labels()` becomes `t("routeExport.*", { lng })`; HTML `<html lang>` uses `i18n.language`; DOCX tables get borders, `Hyperlink` style, `HEADING_2` day headers; PDF page-break guard 250→200mm; XLSX gains frozen rows, autofilter, styled links.
- `src/i18n/locales/{pt-BR,es}.json` — new `routeExport.*` namespace, parity required.
- `src/app/page.tsx` — pass `t()` into export calls.

### Out of Scope
- New formats (CSV, GPX, KML, iCal); server-side rendering; `/api/*` changes; map thumbnails.

## Capabilities

### New Capabilities
- `route-export`: client-side export to HTML, PDF, DOCX, XLSX — locale-aware (pt-BR + es), clickable Google Maps links, professional typography, format-correct structure.

### Modified Capabilities
- `localization`: locale JSONs gain a `routeExport.*` namespace with full parity; `routeExport.ts` consumes keys via `t()`. Delta spec follows.

## Approach

1. **Labels via i18n** — drop `labels(locale)`, call `t("routeExport.*", { lng })` directly.
2. **HTML** — `i18n.language` for `<html lang>`; body 15px; `@page { margin: 1.5cm }`.
3. **PDF** — page-break guard `y > 200`; `autoTable` adds `pageBreak: "auto"`, `rowPageBreak: "avoid"`, `alternateRowStyles`.
4. **DOCX** — declare `Hyperlink` style; add `SINGLE` borders to every `TableCell`; demote day headers to `HEADING_2`.
5. **XLSX** — freeze + autofilter; styled underline-blue cell for maps link.

## Affected Areas

- `src/lib/routeExport.ts` — modified
- `src/i18n/locales/{pt-BR,es}.json` — +`routeExport.*` namespace
- `src/app/page.tsx` — pass `t()` into export calls
- `openspec/specs/route-export/spec.md` — new
- `openspec/specs/localization/spec.md` — delta (parity)

## Risks

- **Locale JSON key drift** — `localization` spec already requires parity.
- **`t()` outside React** — `routeExport.ts` is client-only; `i18n.t` works.
- **No test runner** — hand-build 1/5/20-day fixtures per phase; `tsc` + `next build` gates.

## Rollback Plan

One atomic commit per format. `git revert <sha>` restores current output. Locale additions are additive.

## Dependencies

None — all 4 libraries already in `package.json`.

## Success Criteria

- [ ] `tsc --noEmit` + `next lint` + `next build` pass
- [ ] All 4 formats in `pt-BR` show Portuguese; HTML `<html lang>` matches `i18n.language` exactly
- [ ] DOCX: borders, `Resumo` H1 + `Dia N` H2 outline, blue-underlined maps link
- [ ] PDF with 20 days does not overflow A4; XLSX: frozen header, autofilter, styled clickable maps link
- [ ] `route-export` spec created; `localization` delta merged; `routeExport.*` key sets identical in both locales
