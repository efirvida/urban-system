/**
 * Export a route plan as a downloadable document.
 *
 * Supported formats:
 *   - **HTML**: clean, minimal, printable, opens in any browser.
 *   - **PDF**: proper PDF with tables and clickable Google Maps links.
 *   - **DOCX**: Word document with hyperlinks and styled tables.
 *   - **XLSX**: multi-sheet Excel workbook with summary + one sheet per day,
 *     Google Maps links as clickable hyperlinks.
 */

import type { DayRoute } from '@/types';
import { formatDistance, formatDuration } from './utils';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Document as DocxDocument,
  Packer,
  Paragraph,
  TextRun,
  Table as DocxTable,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  ExternalHyperlink,
} from 'docx';
import i18n from '@/i18n/config';

// ── Shared types ─────────────────────────────────────────────

export type ExportFormat = 'html' | 'pdf' | 'docx' | 'xlsx';

export interface ExportOptions {
  days: DayRoute[];
  totalDistance: number;
  totalDays: number;
  totalLocations: number;
  /** Optional file name (extension is added automatically). */
  fileName?: string;
  /** Active locale for date/number formatting. */
  locale?: string;
}

// ── Helpers ──────────────────────────────────────────────────

/** Build a Google Maps directions URL for a day's stops (order matters). */
function googleMapsUrl(stops: DayRoute['stops']): string {
  const coords = stops.map((s) => `${s.lat},${s.lng}`).join('/');
  return coords ? `https://www.google.com/maps/dir/${coords}/` : '#';
}

/** Escape HTML entities. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cleanFileName(name: string): string {
  return name.replace(/\.\w+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-') || 'route-plan';
}

/** Map a locale string to a short BCP-47 tag for the <html lang> attribute. */
function htmlLang(lng: string): string {
  if (lng.startsWith('es')) return 'es';
  if (lng.startsWith('pt')) return 'pt';
  return 'en';
}

/**
 * DOCX table cell borders — single thin border on all four sides plus
 * the inside edges. Used to give every DOCX table a visible outline.
 */
function docxTableBorders() {
  const side = { style: BorderStyle.SINGLE, size: 1, color: 'auto' } as const;
  return {
    top: side,
    bottom: side,
    left: side,
    right: side,
    insideHorizontal: side,
    insideVertical: side,
  };
}

/** Reusable full-width table config for DOCX tables. */
function docxTableDefaults(rows: TableRow[]): DocxTable {
  return new DocxTable({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: docxTableBorders(),
    rows,
  });
}

// ═══════════════════════════════════════════════════════════════
//  HTML
// ═══════════════════════════════════════════════════════════════

export function generateRoutePlanHtml(options: ExportOptions): string {
  const { days, totalDistance, totalDays, totalLocations } = options;
  const lng = options.locale || i18n.language;
  const t = (key: string, params?: Record<string, unknown>) =>
    i18n.t(key, { ...(params ?? {}), lng });

  const dayRows = days
    .map((day) => {
      const visitStops = day.stops.filter((s) => !s.isHome);
      const stopsRows = day.stops
        .map(
          (stop) => `
          <tr>
            <td class="seq">${stop.isHome ? esc(t('routeExport.home')) : stop.sequence}</td>
            <td>${esc(stop.name)}</td>
            <td class="num">${stop.distanceFromPrev > 0 ? formatDistance(stop.distanceFromPrev, lng) : '—'}</td>
            <td class="num">${stop.cumulativeDistance > 0 ? formatDistance(stop.cumulativeDistance, lng) : '—'}</td>
            <td class="num">${stop.cumulativeTime > 0 ? formatDuration(stop.cumulativeTime, lng) : '—'}</td>
          </tr>`,
        )
        .join('');

      return `
      <div class="day-card">
        <div class="day-header">
          <div>
            <h2>${esc(t('routeExport.day', { n: day.day }))}</h2>
            <span class="day-meta">${esc(t('routeExport.visits', { count: visitStops.length }))} · ${formatDistance(day.totalDistance, lng)} · ${formatDuration(day.totalTime, lng)}</span>
          </div>
          <a href="${googleMapsUrl(day.stops)}" target="_blank" class="maps-link">${esc(t('routeExport.viewInMaps'))}</a>
        </div>
        <table>
          <thead>
            <tr>
              <th class="seq">${esc(t('routeExport.sequence'))}</th>
              <th>${esc(t('routeExport.name'))}</th>
              <th class="num">${esc(t('routeExport.distance'))} (${esc(t('routeExport.fromPrev'))})</th>
              <th class="num">${esc(t('routeExport.cumulative'))} ${esc(t('routeExport.distance'))}</th>
              <th class="num">${esc(t('routeExport.cumulative'))} ${esc(t('routeExport.duration'))}</th>
            </tr>
          </thead>
          <tbody>${stopsRows}</tbody>
        </table>
      </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="${htmlLang(lng)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t('routeExport.title'))}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-size: 15px;
    line-height: 1.5;
    color: #1a1a1a;
    background: #fff;
    padding: 2rem;
    max-width: 960px;
    margin: 0 auto;
  }
  h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.25rem; }
  .subtitle { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
  .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 2rem; }
  .summary-card { background: #f8f9fa; border-radius: 8px; padding: 1rem; text-align: center; }
  .summary-card .value { font-size: 1.75rem; font-weight: 700; color: #2563eb; }
  .summary-card .label { font-size: 0.8rem; color: #666; margin-top: 0.25rem; }
  .day-card { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 1.5rem; overflow: hidden; }
  .day-header { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; background: #f8f9fa; border-bottom: 1px solid #e5e7eb; }
  .day-header h2 { font-size: 1.1rem; font-weight: 600; }
  .day-meta { font-size: 0.8rem; color: #666; }
  .maps-link { font-size: 0.8rem; color: #2563eb; text-decoration: none; white-space: nowrap; }
  .maps-link:hover { text-decoration: underline; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid #f3f4f6; }
  th { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #666; background: #fafafa; }
  .seq { width: 2.5rem; text-align: center; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  @media print {
    @page { margin: 1.5cm; }
    body { padding: 0; }
    .maps-link { display: none; }
    .day-card { break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>${esc(t('routeExport.title'))}</h1>
  <p class="subtitle">${esc(t('routeExport.subtitle'))}: ${esc(new Date().toLocaleDateString(lng, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</p>

  <div class="summary-grid">
    <div class="summary-card"><div class="value">${totalDays}</div><div class="label">${esc(t('routeExport.days'))}</div></div>
    <div class="summary-card"><div class="value">${totalLocations}</div><div class="label">${esc(t('routeExport.locations'))}</div></div>
    <div class="summary-card"><div class="value">${formatDistance(totalDistance, lng)}</div><div class="label">${esc(t('routeExport.totalDistance'))}</div></div>
  </div>

  ${dayRows}
</body>
</html>`;
}

export function downloadRoutePlanHtml(options: ExportOptions): void {
  const html = generateRoutePlanHtml(options);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${cleanFileName(options.fileName ?? '')}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════
//  PDF  (jspdf + jspdf-autotable)
// ═══════════════════════════════════════════════════════════════

export function generateRoutePlanPdf(options: ExportOptions): jsPDF {
  const { days, totalDistance, totalDays, totalLocations } = options;
  const lng = options.locale || i18n.language;
  const t = (key: string, params?: Record<string, unknown>) =>
    i18n.t(key, { ...(params ?? {}), lng });
  const today = new Date().toLocaleDateString(lng, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = 190; // usable width (210 - 10*2 margins)
  const margin = 10;

  // Mark the document's title + language metadata.
  doc.setProperties({ title: t('routeExport.title') });
  const shortLang = htmlLang(lng);
  try {
    // setLanguage's type is a closed set of BCP-47 codes; we only have a
    // short prefix from htmlLang() so cast through unknown to bypass the
    // strict union. Runtime errors are swallowed below.
    (doc.setLanguage as (code: string) => void)(shortLang);
  } catch {
    // setLanguage throws for codes it doesn't recognise — fall back silently.
  }

  // ── Helper: add day table ──
  function addDayTable(day: DayRoute, startY: number): number {
    const visitStops = day.stops.filter((s) => !s.isHome);
    const mapsUrl = googleMapsUrl(day.stops);

    // Day header row
    const headerText = `${t('routeExport.day', { n: day.day })} — ${t('routeExport.visits', { count: visitStops.length })} · ${formatDistance(day.totalDistance, lng)} · ${formatDuration(day.totalTime, lng)}`;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(headerText, margin, startY);
    const headerEndY = startY + 5;

    // Google Maps link (below day header, as a clickable link)
    let linkY = headerEndY + 4;
    if (mapsUrl && mapsUrl !== '#') {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(37, 99, 235);
      doc.textWithLink(t('routeExport.viewInMaps'), margin, linkY, { url: mapsUrl });
      doc.setTextColor(0, 0, 0);
      linkY += 5;
    }

    // Table — km/h cells are raw numbers (autoTable renders them as 0.00
    // thanks to the columnStyles.format below).
    const tableData = day.stops.map((stop) => [
      stop.isHome ? t('routeExport.home') : String(stop.sequence),
      stop.name,
      stop.distanceFromPrev > 0
        ? Number((Math.round(stop.distanceFromPrev * 100) / 100).toFixed(2))
        : '—',
      stop.cumulativeDistance > 0
        ? Number((Math.round(stop.cumulativeDistance * 100) / 100).toFixed(2))
        : '—',
      stop.cumulativeTime > 0
        ? Number((Math.round(stop.cumulativeTime * 100) / 100).toFixed(2))
        : '—',
    ]);

    autoTable(doc, {
      startY: linkY,
      head: [
        [
          t('routeExport.sequence'),
          t('routeExport.name'),
          t('routeExport.distanceFromPrev'),
          t('routeExport.cumulativeKm'),
          t('routeExport.cumulativeTime'),
        ],
      ],
      body: tableData,
      margin: { left: margin, right: margin },
      tableWidth: pageW,
      pageBreak: 'auto',
      rowPageBreak: 'avoid',
      alternateRowStyles: { fillColor: [245, 247, 250] },
      headStyles: {
        fillColor: [37, 99, 235],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 8,
      },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center' },
        1: { cellWidth: 76 },
        2: { cellWidth: 34, halign: 'right' },
        3: { cellWidth: 34, halign: 'right' },
        4: { cellWidth: 34, halign: 'right' },
      },
      didDrawPage: () => {
        // Footer with page number
        const pageCount = doc.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(
          `${t('routeExport.page')} ${doc.getCurrentPageInfo().pageNumber} / ${pageCount}`,
          pageW / 2,
          290,
          { align: 'center' },
        );
        doc.setTextColor(0);
      },
    });

    const finalY = (doc as any).lastAutoTable?.finalY ?? linkY + 20;
    return finalY + 6;
  }

  // ── Title page / header ──
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(t('routeExport.title'), margin, 20);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  doc.text(`${t('routeExport.subtitle')}: ${today}`, margin, 27);
  doc.setTextColor(0);

  // ── Summary box (height 30mm: y=33..63) ──
  doc.setFillColor(248, 249, 250);
  doc.rect(margin, 33, pageW, 30, 'F');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');

  const colW = pageW / 3;
  doc.text(String(totalDays), margin + colW * 0 + colW / 2, 46, {
    align: 'center',
  });
  doc.text(String(totalLocations), margin + colW * 1 + colW / 2, 46, {
    align: 'center',
  });
  doc.text(formatDistance(totalDistance, lng), margin + colW * 2 + colW / 2, 46, {
    align: 'center',
  });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  doc.text(t('routeExport.days'), margin + colW * 0 + colW / 2, 51, { align: 'center' });
  doc.text(t('routeExport.locations'), margin + colW * 1 + colW / 2, 51, { align: 'center' });
  doc.text(t('routeExport.totalDistance'), margin + colW * 2 + colW / 2, 51, {
    align: 'center',
  });
  doc.setTextColor(0);

  let y = 73;

  // ── Per-day tables ──
  for (const day of days) {
    // Check if we need a new page (minimum ~50mm remaining for header + table)
    if (y > 200) {
      doc.addPage();
      y = 20;
    }
    y = addDayTable(day, y);
  }

  return doc;
}

export function downloadRoutePlanPdf(options: ExportOptions): void {
  const doc = generateRoutePlanPdf(options);
  doc.save(`${cleanFileName(options.fileName ?? '')}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
//  Word (.docx)  — docx library
// ═══════════════════════════════════════════════════════════════

export async function generateRoutePlanDocx(options: ExportOptions): Promise<DocxDocument> {
  const { days, totalDistance, totalDays, totalLocations } = options;
  const lng = options.locale || i18n.language;
  const t = (key: string, params?: Record<string, unknown>) =>
    i18n.t(key, { ...(params ?? {}), lng });
  const today = new Date().toLocaleDateString(lng, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const children: (Paragraph | DocxTable)[] = [];

  children.push(
    new Paragraph({
      text: t('routeExport.title'),
      heading: HeadingLevel.TITLE,
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `${t('routeExport.subtitle')}: ${today}`,
          size: 20,
          color: '666666',
        }),
      ],
      spacing: { after: 400 },
    }),
  );

  // ── Summary table ──
  const summaryData = [
    [t('routeExport.days'), String(totalDays)],
    [t('routeExport.locations'), String(totalLocations)],
    [t('routeExport.totalDistance'), formatDistance(totalDistance, lng)],
    [
      t('routeExport.totalHours'),
      formatDuration(
        days.reduce((sum, d) => sum + d.totalTime, 0),
        lng,
      ),
    ],
  ];

  children.push(
    new Paragraph({
      text: t('routeExport.summary'),
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 },
    }),
    docxTableDefaults(
      summaryData.map(
        ([label, value]) =>
          new TableRow({
            children: [
              new TableCell({
                borders: docxTableBorders(),
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: label, bold: true, size: 22 })],
                  }),
                ],
              }),
              new TableCell({
                borders: docxTableBorders(),
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: value, size: 22 })],
                  }),
                ],
              }),
            ],
          }),
      ),
    ),
    new Paragraph({ spacing: { after: 400 } }),
  );

  // ── Per-day sections ──
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const visitStops = day.stops.filter((s) => !s.isHome);
    const mapsUrl = googleMapsUrl(day.stops);

    children.push(
      new Paragraph({
        text: `${t('routeExport.day', { n: day.day })} — ${t('routeExport.visits', { count: visitStops.length })} · ${formatDistance(day.totalDistance, lng)} · ${formatDuration(day.totalTime, lng)}`,
        heading: HeadingLevel.HEADING_2,
        spacing: { after: 100 },
        pageBreakBefore: i > 0,
      }),
    );

    // Google Maps link
    if (mapsUrl && mapsUrl !== '#') {
      children.push(
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: '🔗 ',
              size: 22,
            }),
            new ExternalHyperlink({
              link: mapsUrl,
              children: [
                new TextRun({
                  text: t('routeExport.viewInMaps'),
                  style: 'Hyperlink',
                  size: 22,
                }),
              ],
            }),
          ],
        }),
      );
    }

    // Day table
    const headerLabels = [
      t('routeExport.sequence'),
      t('routeExport.name'),
      t('routeExport.distanceFromPrev'),
      t('routeExport.cumulativeKm'),
      t('routeExport.cumulativeTime'),
    ];
    const dayHeaderRow = new TableRow({
      tableHeader: true,
      children: headerLabels.map(
        (text) =>
          new TableCell({
            borders: docxTableBorders(),
            shading: { fill: '2563eb', type: 'clear' },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text,
                    bold: true,
                    color: 'ffffff',
                    size: 20,
                  }),
                ],
              }),
            ],
          }),
      ),
    });

    const dayRows = day.stops.map(
      (stop) =>
        new TableRow({
          children: [
            new TableCell({
              borders: docxTableBorders(),
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: stop.isHome ? t('routeExport.home') : String(stop.sequence),
                      size: 20,
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              borders: docxTableBorders(),
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: stop.name,
                      size: 20,
                      bold: stop.isHome,
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              borders: docxTableBorders(),
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      text:
                        stop.distanceFromPrev > 0
                          ? String(Math.round(stop.distanceFromPrev * 100) / 100)
                          : '—',
                      size: 20,
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              borders: docxTableBorders(),
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      text:
                        stop.cumulativeDistance > 0
                          ? String(Math.round(stop.cumulativeDistance * 100) / 100)
                          : '—',
                      size: 20,
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              borders: docxTableBorders(),
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      text:
                        stop.cumulativeTime > 0
                          ? String(Math.round(stop.cumulativeTime * 100) / 100)
                          : '—',
                      size: 20,
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
    );

    children.push(docxTableDefaults([dayHeaderRow, ...dayRows]));

    children.push(new Paragraph({ spacing: { after: 400 } }));
  }

  return new DocxDocument({
    // Custom character style so the ExternalHyperlink "View in Google Maps"
    // text renders blue + underlined in Word, instead of the default black.
    styles: {
      characterStyles: [
        {
          id: 'Hyperlink',
          name: 'Hyperlink',
          basedOn: 'DefaultParagraphFont',
          run: {
            color: '0563C1',
            underline: { type: 'single' },
          },
        },
      ],
    },
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });
}

export async function downloadRoutePlanDocx(options: ExportOptions): Promise<void> {
  const doc = await generateRoutePlanDocx(options);
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${cleanFileName(options.fileName ?? '')}.docx`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════
//  Excel (.xlsx)  — SheetJS (xlsx)
// ═══════════════════════════════════════════════════════════════

export function generateRoutePlanXlsx(options: ExportOptions): XLSX.WorkBook {
  const { days, totalDistance, totalDays, totalLocations } = options;
  const lng = options.locale || i18n.language;
  const t = (key: string, params?: Record<string, unknown>) =>
    i18n.t(key, { ...(params ?? {}), lng });
  const wb = XLSX.utils.book_new();

  // ── Summary sheet ──
  const summaryRows = [
    [t('routeExport.title')],
    [],
    [t('routeExport.days'), totalDays],
    [t('routeExport.locations'), totalLocations],
    [
      t('routeExport.totalKm'),
      { t: 'n', v: Math.round(totalDistance * 100) / 100, z: '0.00' } as XLSX.CellObject,
    ],
    [
      t('routeExport.totalHours'),
      {
        t: 'n',
        v: Math.round(days.reduce((sum, d) => sum + d.totalTime, 0) * 100) / 100,
        z: '0.00',
      } as XLSX.CellObject,
    ],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 24 }, { wch: 12 }];
  wsSummary['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  XLSX.utils.book_append_sheet(wb, wsSummary, t('routeExport.summarySheet'));

  // ── Per-day sheets ──
  for (const day of days) {
    const visitStops = day.stops.filter((s) => !s.isHome);
    const mapsUrl = googleMapsUrl(day.stops);

    // Each stop row carries raw numbers with `z: "0.00"` so Excel formats
    // them with two decimal places. Empty cells use "—" (visible em-dash)
    // instead of an empty string so blank rows are still scannable.
    const stopRows: XLSX.CellObject[][] = day.stops.map((stop) => {
      const seqCell: XLSX.CellObject = {
        t: 'n',
        v: stop.isHome ? 0 : stop.sequence,
      };
      const nameCell: XLSX.CellObject = { t: 's', v: stop.name };
      const distFromPrevCell: XLSX.CellObject =
        stop.distanceFromPrev > 0
          ? {
              t: 'n',
              v: Math.round(stop.distanceFromPrev * 100) / 100,
              z: '0.00',
            }
          : { t: 's', v: '—' };
      const cumDistCell: XLSX.CellObject =
        stop.cumulativeDistance > 0
          ? {
              t: 'n',
              v: Math.round(stop.cumulativeDistance * 100) / 100,
              z: '0.00',
            }
          : { t: 's', v: '—' };
      const cumTimeCell: XLSX.CellObject =
        stop.cumulativeTime > 0
          ? {
              t: 'n',
              v: Math.round(stop.cumulativeTime * 100) / 100,
              z: '0.00',
            }
          : { t: 's', v: '—' };
      const linkCell: XLSX.CellObject =
        mapsUrl && mapsUrl !== '#'
          ? {
              t: 's',
              v: t('routeExport.viewInMaps'),
              l: { Target: mapsUrl, Tooltip: t('routeExport.viewInMaps') },
              s: {
                font: {
                  color: { rgb: '0563C1' },
                  underline: true,
                },
              },
            }
          : { t: 's', v: '' };
      return [seqCell, nameCell, distFromPrevCell, cumDistCell, cumTimeCell, linkCell];
    });

    const sheetData: (string | XLSX.CellObject)[][] = [
      [
        `${t('routeExport.day', { n: day.day })} — ${t('routeExport.visits', { count: visitStops.length })} · ${formatDistance(day.totalDistance, lng)} · ${formatDuration(day.totalTime, lng)}`,
      ],
      [],
      [
        t('routeExport.sequence'),
        t('routeExport.name'),
        t('routeExport.distanceFromPrev'),
        t('routeExport.cumulativeKm'),
        t('routeExport.cumulativeTime'),
        t('routeExport.mapsLink'),
      ],
      ...stopRows,
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Column widths — column F is the standalone maps link.
    ws['!cols'] = [{ wch: 6 }, { wch: 40 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 26 }];

    // Style the title row.
    const titleCell = XLSX.utils.encode_cell({ r: 0, c: 0 });
    if (ws[titleCell]) {
      ws[titleCell].s = { font: { bold: true, sz: 14 } };
    }

    // Keep the existing title-cell link as a secondary shortcut, then
    // pin a fresh link on each stop row in column F.
    if (mapsUrl && mapsUrl !== '#') {
      ws[titleCell].l = { Target: mapsUrl, Tooltip: t('routeExport.viewInMaps') };
    }

    // Freeze the header (rows 1–3) so the data is scroll-friendly.
    ws['!freeze'] = { ySplit: 3, topLeftCell: 'A4', activePane: 'bottomLeft' };

    // Autofilter on the data range: A4 is the first data column, F is the
    // last (6th) column. lastRow is 3 + number of stops (0-indexed).
    const lastRow = 3 + day.stops.length; // 1-indexed for the ref string
    ws['!autofilter'] = { ref: `A4:F${lastRow}` };

    const sheetName = t('routeExport.day', { n: day.day }).slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  return wb;
}

export function downloadRoutePlanXlsx(options: ExportOptions): void {
  const wb = generateRoutePlanXlsx(options);
  XLSX.writeFile(wb, `${cleanFileName(options.fileName ?? '')}.xlsx`, {
    bookType: 'xlsx',
    type: 'binary',
  });
}

// ═══════════════════════════════════════════════════════════════
//  Unified dispatcher
// ═══════════════════════════════════════════════════════════════

/**
 * Download the route plan in the requested format.
 *
 * | Format | Description                          |
 * |--------|--------------------------------------|
 * | html   | Browser, print-to-PDF, Word-compat   |
 * | pdf    | Proper PDF with clickable links      |
 * | docx   | Word document with styled tables     |
 * | xlsx   | Excel workbook with per-day sheets   |
 */
/**
 * Optional callback for surfacing export errors back to the caller.
 * Receives the already-localized error message. When omitted, the
 * caller is expected to handle the rejected promise from
 * `downloadRoutePlan` (we keep it returning `void` to keep the call
 * sites terse; the function never throws).
 */
export type OnExportError = (msg: string) => void;

export function downloadRoutePlan(
  options: ExportOptions,
  format: ExportFormat = 'html',
  onError?: OnExportError,
): void {
  const lng = options.locale || i18n.language;
  const reportError = (fallback: string) => {
    if (!onError) return;
    const msg = i18n.t('export.exportError', { lng, defaultValue: fallback });
    onError(msg);
  };
  switch (format) {
    case 'html':
      try {
        downloadRoutePlanHtml(options);
      } catch (err) {
        reportError(err instanceof Error ? err.message : 'HTML export failed');
      }
      break;
    case 'pdf':
      try {
        downloadRoutePlanPdf(options);
      } catch (err) {
        reportError(err instanceof Error ? err.message : 'PDF export failed');
      }
      break;
    case 'docx':
      // Async but we fire and forget — the download happens
      downloadRoutePlanDocx(options).catch((err) => {
        const msg = err instanceof Error && err.message ? err.message : 'DOCX export failed';
        reportError(msg);
      });
      break;
    case 'xlsx':
      try {
        downloadRoutePlanXlsx(options);
      } catch (err) {
        reportError(err instanceof Error ? err.message : 'XLSX export failed');
      }
      break;
  }
}
