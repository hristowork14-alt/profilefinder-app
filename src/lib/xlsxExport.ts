// Bulk results as a formatted Excel workbook (.xlsx).
//
// Why not CSV: Excel with Bulgarian (and most European) regional settings expects ";" as the CSV
// separator, so a comma CSV opens as one long column; and CSV can't carry bold text, borders or
// colours. This module builds a real workbook instead:
//   • "Results": a summary (how many rows per status) above one row per company in file order —
//     row number, company, position, a plain-language status, the person, their LinkedIn profile,
//     why, and the best independent source with what it says. Frozen, filterable header.
//   • "Needs review": the same columns, only the rows to check (possible, conflicting, not found,
//     failed, not searched yet).
//   • "All matches": every returned profile with its rank.
//   • "How to read": what every status means and what to do about it.
// Loaded on demand (dynamic import from the Bulk page), so exceljs never weighs on the main bundle.

import ExcelJS from 'exceljs';
import type { RankedProfile } from '@shared/types';
import type { ExportRow } from './csv';
import { STATUS_ORDER, rowStatus, statusCounts, statusInfo, type StatusKey } from './resultStatus';

/** The header is on this row; rows 1–4 hold the title, file details, summary counts and a note. */
export const HEADER_ROW = 6;

const COLORS = {
  ink: 'FF17222A',
  muted: 'FF56636B',
  headerFill: 'FF1E3A8A',
  headerText: 'FFFFFFFF',
  border: 'FFC9D1D9',
  zebra: 'FFF6F8FA',
  link: 'FF2A45C9',
};

type Tone = 'green' | 'blue' | 'amber' | 'orange' | 'grey' | 'red';

const TONES: Record<Tone, { fill: string; font: string }> = {
  green: { fill: 'FFD9F0E2', font: 'FF1D6F44' },
  blue: { fill: 'FFE3E8FB', font: 'FF2A45C9' },
  amber: { fill: 'FFF9ECC4', font: 'FF835C00' },
  orange: { fill: 'FFFCE1CC', font: 'FF9A3D00' },
  grey: { fill: 'FFE4E8E5', font: 'FF56636B' },
  red: { fill: 'FFFBE3E1', font: 'FFA8231C' },
};

const STATUS_TONE: Record<StatusKey, Tone> = {
  verified: 'green',
  verified_no_profile: 'blue',
  match: 'blue',
  possible: 'amber',
  many: 'amber',
  conflict: 'orange',
  not_found: 'grey',
  failed: 'red',
  pending: 'grey',
};

export interface ExportMeta {
  fileName: string;
  exportedAt: Date;
}

function safeUrl(url: string | undefined): string | null {
  return url && /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}

function link(text: string, url: string | undefined): ExcelJS.CellHyperlinkValue | null {
  const safe = safeUrl(url);
  return safe ? { text, hyperlink: safe } : null;
}

function confidenceTone(confidence: number): Tone {
  return confidence >= 75 ? 'green' : confidence >= 50 ? 'amber' : 'grey';
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

function writeTop(ws: ExcelJS.Worksheet, last: number, lines: { text: string; size?: number; bold?: boolean; color?: string }[]): void {
  lines.forEach((line, i) => {
    const r = i + 1;
    ws.mergeCells(r, 1, r, last);
    const cell = ws.getCell(r, 1);
    cell.value = line.text;
    cell.font = { bold: Boolean(line.bold), size: line.size ?? 10, color: { argb: line.color ?? COLORS.muted } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    ws.getRow(r).height = line.size && line.size > 12 ? 24 : 18;
  });
}

function setUpTable(ws: ExcelJS.Worksheet, columns: Column[]): void {
  ws.columns = columns.map((c) => ({ width: c.width }));
  const header = ws.getRow(HEADER_ROW);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: COLORS.headerText } };
    cell.fill = solid(COLORS.headerFill);
    cell.alignment = { vertical: 'middle', horizontal: c.center ? 'center' : 'left', wrapText: true };
    cell.border = thin();
  });
  header.height = 30;

  ws.views = [{ state: 'frozen', ySplit: HEADER_ROW, xSplit: 0, topLeftCell: `A${HEADER_ROW + 1}`, activeCell: `A${HEADER_ROW + 1}` }];
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: columns.length } };
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
    if (column.wrap && typeof value === 'string') lines = Math.max(lines, Math.ceil(value.length / Math.max(10, column.width * 1.1)));
  });
  row.height = Math.max(20, Math.min(150, lines * 15 + 5));
  return row;
}

function paint(cell: ExcelJS.Cell, tone: Tone, bold = true): void {
  cell.fill = solid(TONES[tone].fill);
  cell.font = { bold, color: { argb: TONES[tone].font } };
}

const RESULT_COLUMNS: Column[] = [
  { header: 'Row', width: 6, center: true },
  { header: 'Company', width: 20, bold: true },
  { header: 'Position', width: 22, bold: true },
  { header: 'Status', width: 36, wrap: true },
  { header: 'Person', width: 24, bold: true },
  { header: 'Current title', width: 32, wrap: true },
  { header: 'LinkedIn profile', width: 40 },
  { header: 'Confidence', width: 12, center: true },
  { header: 'Why', width: 55, wrap: true },
  { header: 'Best source', width: 40, wrap: true },
  { header: 'What the source says', width: 55, wrap: true },
  { header: 'Company website', width: 26 },
];

const MATCH_COLUMNS: Column[] = [
  { header: 'Row', width: 6, center: true },
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

function why(row: ExportRow, status: StatusKey, top: RankedProfile | undefined): string {
  if (status === 'failed') return row.error ?? 'This row could not be searched.';
  if (status === 'pending') return 'Resume the bulk job to search this row.';
  if (top) return top.reasoning;
  if (row.verifiedHolder) {
    const n = row.verifiedHolder.sources;
    return `Independent sources${n ? ` (${n})` : ''} name ${row.verifiedHolder.name} as ${row.position} at ${row.companyName ?? row.companyUrl}, but no public LinkedIn profile was found.`;
  }
  return statusInfo(status).action;
}

function formatStamp(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function resultValues(row: ExportRow, index: number): { values: CellValue[]; status: StatusKey; top: RankedProfile | undefined } {
  const top = row.results[0];
  const status = rowStatus(row);
  const source = row.verifiedHolder?.sourceLinks.find((l) => safeUrl(l.url));
  return {
    status,
    top,
    values: [
      row.rowNumber ?? index + 1,
      row.companyName ?? row.companyUrl,
      row.position,
      statusInfo(status).label,
      top?.fullName ?? row.verifiedHolder?.name ?? '—',
      top?.headline ?? '',
      top ? link(top.linkedinUrl, top.linkedinUrl) : null,
      top ? top.confidence : null,
      why(row, status, top),
      source ? link(source.title || source.url, source.url) : null,
      source?.quote ?? '',
      row.companyUrl,
    ],
  };
}

function writeResultRows(ws: ExcelJS.Worksheet, rows: { row: ExportRow; index: number }[]): void {
  const statusCol = RESULT_COLUMNS.findIndex((c) => c.header === 'Status') + 1;
  const confidenceCol = RESULT_COLUMNS.findIndex((c) => c.header === 'Confidence') + 1;
  rows.forEach(({ row, index }, position) => {
    const { values, status, top } = resultValues(row, index);
    const written = writeRow(ws, HEADER_ROW + 1 + position, RESULT_COLUMNS, values, position % 2 === 1);
    paint(written.getCell(statusCol), STATUS_TONE[status]);
    if (top) {
      const confidence = written.getCell(confidenceCol);
      confidence.numFmt = '0"%"';
      paint(confidence, confidenceTone(top.confidence));
    }
  });
}

const LINK_NOTE =
  'LinkedIn links come from Google search results — ProfileFinder never opens LinkedIn, so a profile may be out of date. Statuses are explained on the "How to read" sheet.';

export async function buildResultsWorkbook(rows: ExportRow[], meta: ExportMeta): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ProfileFinder';
  wb.created = meta.exportedAt;

  const counts = statusCounts(rows);
  const details = `File: ${meta.fileName}  ·  Exported ${formatStamp(meta.exportedAt)}  ·  ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`;
  const summary = counts.map((c) => `${c.label} ${c.count}`).join('   ·   ');
  const indexed = rows.map((row, index) => ({ row, index }));

  // Sheet 1 — one row per company, with a summary on top.
  const results = wb.addWorksheet('Results', { properties: { tabColor: { argb: COLORS.headerFill } } });
  setUpTable(results, RESULT_COLUMNS);
  writeTop(results, RESULT_COLUMNS.length, [
    { text: 'ProfileFinder — bulk results', size: 14, bold: true, color: COLORS.ink },
    { text: details },
    { text: summary, bold: true, color: COLORS.ink, size: 11 },
    { text: LINK_NOTE },
  ]);
  writeResultRows(results, indexed);

  // Sheet 2 — only the rows that need a look.
  const review = wb.addWorksheet('Needs review', { properties: { tabColor: { argb: TONES.amber.font } } });
  setUpTable(review, RESULT_COLUMNS);
  const toReview = indexed.filter(({ row }) => statusInfo(rowStatus(row)).group !== 'found');
  writeTop(review, RESULT_COLUMNS.length, [
    { text: 'Rows to check before using', size: 14, bold: true, color: COLORS.ink },
    { text: details },
    {
      text: `${toReview.length} of ${rows.length} rows: possible matches, conflicting information, not found, failed or not searched yet.`,
    },
    { text: 'The "Row" column is the row number in your file. Every row is also on the "Results" sheet.' },
  ]);
  writeResultRows(review, toReview);

  // Sheet 3 — every match with its rank.
  const matches = wb.addWorksheet('All matches');
  setUpTable(matches, MATCH_COLUMNS);
  writeTop(matches, MATCH_COLUMNS.length, [
    { text: 'ProfileFinder — all matches', size: 14, bold: true, color: COLORS.ink },
    { text: details },
    { text: 'Every profile returned for each row, best first.' },
    { text: LINK_NOTE },
  ]);
  let next = HEADER_ROW + 1;
  rows.forEach((row, index) => {
    const number = row.rowNumber ?? index + 1;
    const lines: CellValue[][] = row.results.length
      ? row.results.map((r, rank) => [
          number,
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
            number,
            row.companyUrl,
            row.position,
            null,
            row.verifiedHolder?.name ?? '—',
            '',
            null,
            null,
            row.verifiedHolder ? 'Yes · no profile' : '',
            why(row, rowStatus(row), undefined),
          ],
        ];
    for (const values of lines) {
      const written = writeRow(matches, next, MATCH_COLUMNS, values, index % 2 === 1);
      const confidence = values[7];
      if (typeof confidence === 'number') {
        written.getCell(8).numFmt = '0"%"';
        paint(written.getCell(8), confidenceTone(confidence));
      }
      if (values[8] === 'Yes' || values[8] === 'Yes · no profile') paint(written.getCell(9), 'green');
      next++;
    }
  });

  // Sheet 4 — the legend.
  const legend = wb.addWorksheet('How to read');
  legend.columns = [{ width: 34 }, { width: 70 }, { width: 55 }];
  legend.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  const title = legend.getCell(1, 1);
  title.value = 'How to read the results';
  title.font = { bold: true, size: 14, color: { argb: COLORS.ink } };
  const head = legend.getRow(3);
  ['Status', 'What it means', 'What to do'].forEach((text, i) => {
    const cell = head.getCell(i + 1);
    cell.value = text;
    cell.font = { bold: true, color: { argb: COLORS.headerText } };
    cell.fill = solid(COLORS.headerFill);
    cell.border = thin();
  });
  STATUS_ORDER.forEach((key, i) => {
    const info = statusInfo(key);
    const row = legend.getRow(4 + i);
    [info.label, info.meaning, info.action].forEach((text, c) => {
      const cell = row.getCell(c + 1);
      cell.value = text;
      cell.border = thin();
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.font = { color: { argb: COLORS.ink } };
    });
    paint(row.getCell(1), STATUS_TONE[key]);
    row.height = 34;
  });
  const notesStart = 5 + STATUS_ORDER.length;
  [
    'Confidence: how sure ProfileFinder is that this profile is the person in the role (75%+ = strong, 50–74% = check it).',
    'Sources: websites other than LinkedIn that name the person in the role. One website counts once; social media, video and contact-data sites only count as extra support.',
    'LinkedIn links come from Google search results. ProfileFinder never opens LinkedIn, so a profile can be out of date even when the person is right.',
    '"Row" is the row number in the file you uploaded (1 = first row under the header).',
  ].forEach((text, i) => {
    const r = notesStart + i;
    legend.mergeCells(r, 1, r, 3);
    const cell = legend.getCell(r, 1);
    cell.value = text;
    cell.alignment = { wrapText: true, vertical: 'top' };
    cell.font = { color: { argb: COLORS.muted } };
    legend.getRow(r).height = 30;
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
