// Bulk results as a formatted Excel workbook (.xlsx).
//
// Why not CSV: Excel with Bulgarian (and most European) regional settings expects ";" as the CSV
// separator, so a comma CSV opens as one long column; and CSV can't carry bold text, borders or
// colours. This module builds a real workbook instead:
//   • "Results": one row per company — the best match, or the verified person when they have no
//     public LinkedIn profile — with bold key columns, borders, a frozen filtered header, clickable
//     links and colour-coded status / confidence.
//   • "All matches": every returned profile with its rank.
// Loaded on demand (dynamic import from the Bulk page), so exceljs never weighs on the main bundle.

import ExcelJS from 'exceljs';
import type { RankedProfile } from '@shared/types';
import type { ExportRow } from './csv';

/** The header is on this row; rows 1–2 hold the title and a one-line summary. */
export const HEADER_ROW = 4;

const COLORS = {
  ink: 'FF17222A',
  muted: 'FF56636B',
  headerFill: 'FF1E3A8A',
  headerText: 'FFFFFFFF',
  border: 'FFC9D1D9',
  zebra: 'FFF6F8FA',
  link: 'FF2A45C9',
};

type Tone = 'verified' | 'holder' | 'unverified' | 'found' | 'none' | 'failed';

const TONES: Record<Tone, { fill: string; font: string }> = {
  verified: { fill: 'FFD9F0E2', font: 'FF1D6F44' },
  holder: { fill: 'FFE3E8FB', font: 'FF2A45C9' },
  unverified: { fill: 'FFF9ECC4', font: 'FF835C00' },
  found: { fill: 'FFE3E8FB', font: 'FF2A45C9' },
  none: { fill: 'FFE4E8E5', font: 'FF56636B' },
  failed: { fill: 'FFFBE3E1', font: 'FFA8231C' },
};

export interface ExportMeta {
  fileName: string;
  exportedAt: Date;
}

/** Plain-language status for one bulk row, and the colour it gets. */
export function resultStatus(row: ExportRow): { label: string; tone: Tone } {
  const top = row.results[0];
  if (row.status === 'failed') return { label: 'Failed', tone: 'failed' };
  if (top?.verified) {
    return { label: row.verifiedHolder ? `Verified by ${row.verifiedHolder.sources} sources` : 'Verified', tone: 'verified' };
  }
  if (!top && row.verifiedHolder) return { label: 'Verified · no public LinkedIn profile', tone: 'holder' };
  if (top) {
    // verifiedHolder === null: verification ran and nobody could be confirmed.
    return row.verifiedHolder === null
      ? { label: 'Not independently verified', tone: 'unverified' }
      : { label: 'Match found', tone: 'found' };
  }
  if (row.status === 'pending' || row.status === 'running') return { label: 'Not searched yet', tone: 'none' };
  return { label: 'No match found', tone: 'none' };
}

function safeUrl(url: string | undefined): string | null {
  return url && /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}

function link(text: string, url: string | undefined): ExcelJS.CellHyperlinkValue | null {
  const safe = safeUrl(url);
  return safe ? { text, hyperlink: safe } : null;
}

function confidenceTone(confidence: number): Tone {
  return confidence >= 75 ? 'verified' : confidence >= 50 ? 'unverified' : 'none';
}

const thin = (): Partial<ExcelJS.Borders> => {
  const side: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: COLORS.border } };
  return { top: side, left: side, bottom: side, right: side };
};

const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

interface Column {
  header: string;
  width: number;
  bold?: boolean;
  wrap?: boolean;
  center?: boolean;
}

function setUpSheet(ws: ExcelJS.Worksheet, columns: Column[], title: string, summary: string): void {
  ws.columns = columns.map((c) => ({ width: c.width }));
  const last = columns.length;

  ws.mergeCells(1, 1, 1, last);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14, color: { argb: COLORS.ink } };
  ws.getRow(1).height = 24;
  ws.mergeCells(2, 1, 2, last);
  const summaryCell = ws.getCell(2, 1);
  summaryCell.value = summary;
  summaryCell.font = { size: 10, color: { argb: COLORS.muted } };

  const header = ws.getRow(HEADER_ROW);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: COLORS.headerText } };
    cell.fill = solid(COLORS.headerFill);
    cell.alignment = { vertical: 'middle', horizontal: c.center ? 'center' : 'left', wrapText: true };
    cell.border = thin();
  });
  header.height = 28;

  ws.views = [{ state: 'frozen', ySplit: HEADER_ROW, xSplit: 0, topLeftCell: `A${HEADER_ROW + 1}`, activeCell: `A${HEADER_ROW + 1}` }];
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: last } };
  ws.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
  };
}

type CellValue = string | number | ExcelJS.CellHyperlinkValue | null;

/** Writes one data row: borders, zebra stripes, bold key columns, links, estimated height. */
function writeRow(ws: ExcelJS.Worksheet, rowNumber: number, columns: Column[], values: CellValue[], stripe: boolean): ExcelJS.Row {
  const row = ws.getRow(rowNumber);
  let lines = 1;
  values.forEach((value, i) => {
    const column = columns[i]!;
    const cell = row.getCell(i + 1);
    cell.value = value;
    cell.border = thin();
    cell.alignment = { vertical: 'top', horizontal: column.center ? 'center' : 'left', wrapText: Boolean(column.wrap) };
    if (stripe) cell.fill = solid(COLORS.zebra);
    const isLink = value !== null && typeof value === 'object';
    cell.font = isLink
      ? { color: { argb: COLORS.link }, underline: true, bold: Boolean(column.bold) }
      : { bold: Boolean(column.bold), color: { argb: COLORS.ink } };
    if (column.wrap && typeof value === 'string') lines = Math.max(lines, Math.ceil(value.length / Math.max(10, column.width * 1.15)));
  });
  row.height = Math.max(20, Math.min(120, lines * 15 + 5));
  return row;
}

function paint(cell: ExcelJS.Cell, tone: Tone, bold = true): void {
  cell.fill = solid(TONES[tone].fill);
  cell.font = { bold, color: { argb: TONES[tone].font } };
}

const RESULT_COLUMNS: Column[] = [
  { header: '#', width: 5, center: true },
  { header: 'Company website', width: 24, bold: true },
  { header: 'Position', width: 24, bold: true },
  { header: 'Company', width: 18 },
  { header: 'Person', width: 24, bold: true },
  { header: 'Result', width: 35 },
  { header: 'Confidence', width: 12, center: true },
  { header: 'LinkedIn profile', width: 44 },
  { header: 'Why', width: 60, wrap: true },
  { header: 'Source', width: 38 },
];

const MATCH_COLUMNS: Column[] = [
  { header: '#', width: 5, center: true },
  { header: 'Company website', width: 24, bold: true },
  { header: 'Position', width: 24, bold: true },
  { header: 'Rank', width: 7, center: true },
  { header: 'Person', width: 24, bold: true },
  { header: 'Headline', width: 40, wrap: true },
  { header: 'LinkedIn profile', width: 44 },
  { header: 'Confidence', width: 12, center: true },
  { header: 'Verified', width: 14, center: true },
  { header: 'Why', width: 60, wrap: true },
];

function why(row: ExportRow, top: RankedProfile | undefined): string {
  if (row.status === 'failed') return row.error ?? 'This row could not be searched.';
  if (top) return top.reasoning;
  if (row.verifiedHolder) {
    return `Independent sources name ${row.verifiedHolder.name} as ${row.position} at ${row.companyName ?? row.companyUrl}, but no public LinkedIn profile was found.`;
  }
  return row.status === 'pending' || row.status === 'running' ? 'Resume the bulk job to search this row.' : '';
}

function formatStamp(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export async function buildResultsWorkbook(rows: ExportRow[], meta: ExportMeta): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ProfileFinder';
  wb.created = meta.exportedAt;

  const verifiedCount = rows.filter((r) => r.results[0]?.verified || (!r.results[0] && r.verifiedHolder)).length;
  const summary = `File: ${meta.fileName}  ·  Exported ${formatStamp(meta.exportedAt)}  ·  ${rows.length} companies  ·  ${verifiedCount} with an independently verified person`;

  // Sheet 1 — one row per company.
  const results = wb.addWorksheet('Results', { properties: { tabColor: { argb: COLORS.headerFill } } });
  setUpSheet(results, RESULT_COLUMNS, 'ProfileFinder — bulk results', summary);
  rows.forEach((row, index) => {
    const top = row.results[0];
    const status = resultStatus(row);
    const source = row.verifiedHolder?.sourceLinks.find((l) => safeUrl(l.url));
    const written = writeRow(
      results,
      HEADER_ROW + 1 + index,
      RESULT_COLUMNS,
      [
        index + 1,
        row.companyUrl,
        row.position,
        row.companyName ?? '',
        top?.fullName ?? row.verifiedHolder?.name ?? '—',
        status.label,
        top ? top.confidence : null,
        top ? link(top.linkedinUrl, top.linkedinUrl) : null,
        why(row, top),
        source ? link(source.title || source.url, source.url) : null,
      ],
      index % 2 === 1,
    );
    paint(written.getCell(6), status.tone);
    if (top) {
      const confidence = written.getCell(7);
      confidence.numFmt = '0"%"';
      paint(confidence, confidenceTone(top.confidence));
    }
  });

  // Sheet 2 — every match with its rank.
  const matches = wb.addWorksheet('All matches');
  setUpSheet(matches, MATCH_COLUMNS, 'ProfileFinder — all matches', summary);
  let next = HEADER_ROW + 1;
  rows.forEach((row, index) => {
    const lines: CellValue[][] = row.results.length
      ? row.results.map((r, rank) => [
          index + 1,
          row.companyUrl,
          row.position,
          rank + 1,
          r.fullName,
          r.headline,
          link(r.linkedinUrl, r.linkedinUrl),
          r.confidence,
          r.verified ? 'Yes' : r.verified === false || row.verifiedHolder !== undefined ? 'No' : '',
          r.reasoning,
        ])
      : [
          [
            index + 1,
            row.companyUrl,
            row.position,
            null,
            row.verifiedHolder?.name ?? '—',
            '',
            null,
            null,
            row.verifiedHolder ? 'Yes · no profile' : '',
            why(row, undefined),
          ],
        ];
    for (const values of lines) {
      const written = writeRow(matches, next, MATCH_COLUMNS, values, index % 2 === 1);
      const confidence = values[7];
      if (typeof confidence === 'number') {
        written.getCell(8).numFmt = '0"%"';
        paint(written.getCell(8), confidenceTone(confidence));
      }
      if (values[8] === 'Yes' || values[8] === 'Yes · no profile') paint(written.getCell(9), 'verified');
      next++;
    }
  });

  return wb;
}

/** Builds the workbook and starts the browser download. */
export async function downloadResultsXlsx(rows: ExportRow[], meta: ExportMeta, fileName: string): Promise<void> {
  const wb = await buildResultsWorkbook(rows, meta);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
