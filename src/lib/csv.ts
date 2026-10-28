// CSV parsing/validation for bulk search and the results export (papaparse).

import Papa from 'papaparse';
import { parseCompanyUrl } from '@shared/domain';
import type { Decision } from '@shared/decision';
import type { RankedProfile, VerifiedHolder } from '@shared/types';
import { sanitizeText } from '@shared/validation';
import { rowStatus, statusInfo } from './resultStatus';

export const MAX_BULK_ROWS = 100;

/** Template offered in the real app. */
export const TEMPLATE_CSV = [
  'company_url,position',
  'https://stripe.com,CFO',
  'www.figma.com,Head of Design',
  'canva.com,Head of People',
  '',
].join('\n');

/** Template offered in demo mode: fictional companies, including one that shows a failed row. */
export const DEMO_TEMPLATE_CSV = [
  'company_url,position',
  'nimbus-labs.example,CTO',
  'quietpine.example,Head of Marketing',
  'https://www.northwind-freight.example/about,CFO',
  'brightloop.example,CEO',
  'empty.example,CTO',
  'search-down.example,CTO',
  'northwind-freight.example,Chief Financial Officer',
  '',
].join('\n');

export interface ParsedRow {
  index: number;
  companyUrl: string;
  position: string;
  /** Human-readable reason this row can't be searched, or null if it's fine. */
  error: string | null;
}

export interface ParsedCsv {
  rows: ParsedRow[];
  /** A problem with the whole file (missing columns, too many rows…). */
  fileError: string | null;
}

const COMPANY_HEADERS = ['company_url', 'company'];
const POSITION_HEADERS = ['position', 'title'];

export function parseBulkCsv(text: string): ParsedCsv {
  const clean = text.replace(/^\uFEFF/, '');
  if (!clean.trim()) return { rows: [], fileError: 'The file is empty. Use the template to get started.' };

  const parsed = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', ';', '\t'],
    transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
  });

  const fields = parsed.meta.fields ?? [];
  const companyKey = COMPANY_HEADERS.find((h) => fields.includes(h));
  const positionKey = POSITION_HEADERS.find((h) => fields.includes(h));
  if (!companyKey || !positionKey) {
    return {
      rows: [],
      fileError: 'The first row must be a header with the columns company_url and position (or company and title).',
    };
  }

  const records = parsed.data.filter((record) => Object.values(record).some((value) => String(value ?? '').trim() !== ''));
  if (records.length === 0) return { rows: [], fileError: 'The file has a header but no rows.' };
  if (records.length > MAX_BULK_ROWS) {
    return {
      rows: [],
      fileError: `The file has ${records.length} rows. The limit is ${MAX_BULK_ROWS} rows per file — split it into smaller files.`,
    };
  }

  const rows = records.map((record, index): ParsedRow => {
    const companyUrl = sanitizeText(String(record[companyKey] ?? ''));
    const position = sanitizeText(String(record[positionKey] ?? ''));
    return { index, companyUrl: companyUrl.slice(0, 500), position: position.slice(0, 200), error: validateRowInput(companyUrl, position) };
  });

  return { rows, fileError: null };
}

/** Why a bulk row can't be searched, or null if its input is fine. */
export function validateRowInput(companyUrl: string, position: string): string | null {
  if (!companyUrl) return 'Missing company website.';
  const company = parseCompanyUrl(companyUrl);
  if (!company.ok) return company.error;
  if (position.length < 2) return 'Missing position (at least 2 characters, e.g. CTO).';
  if (position.length > 100) return 'The position must be 100 characters or fewer.';
  return null;
}

export interface ExportRow {
  companyUrl: string;
  position: string;
  companyName: string | null;
  results: RankedProfile[];
  /** Bulk row status; the Excel export uses it to label rows that failed or weren't searched. */
  status?: 'pending' | 'running' | 'completed' | 'failed';
  error?: string | null;
  /** Real app only: the person independent sources name (also when no profile was found). */
  verifiedHolder?: VerifiedHolder | null;
  /** Real app, searches since migration 0004: how the answer was reached. */
  decision?: Decision | null;
  /** The row's number in the uploaded file (1 = first data row). */
  rowNumber?: number;
}

export const EXPORT_COLUMNS = [
  'company_url',
  'position',
  'company_name',
  'rank',
  'full_name',
  'headline',
  'linkedin_url',
  'confidence',
  'reasoning',
];
/** Added after the original columns (so existing imports keep working); real app only. */
export const DETAIL_COLUMNS = ['row', 'status', 'verified_person', 'source_url', 'source_quote'];

/** Prevents CSV formula injection when the file is opened in Excel / Google Sheets. */
function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * One line per returned profile (or one empty line when there is none). With `detailed` (the real
 * app), each line also gets the row number from the file, the plain-language status, the verified
 * person and the best independent source with what it says.
 */
export function buildResultsCsv(rows: ExportRow[], options: { detailed?: boolean } = {}): string {
  const detailed = options.detailed ?? true;
  const data: string[][] = [];
  rows.forEach((row, index) => {
    const base = [safeCell(row.companyUrl), safeCell(row.position), safeCell(row.companyName ?? '')];
    const source = row.verifiedHolder?.sourceLinks.find((l) => /^https?:\/\//i.test(l.url));
    const detail = detailed
      ? [
          String(row.rowNumber ?? index + 1),
          statusInfo(rowStatus(row)).label,
          safeCell(row.verifiedHolder?.name ?? ''),
          source?.url ?? '',
          safeCell(source?.quote ?? ''),
        ]
      : [];
    if (row.results.length === 0) {
      data.push([...base, '', '', '', '', '', '', ...detail]);
      return;
    }
    row.results.forEach((result, i) => {
      data.push([
        ...base,
        String(i + 1),
        safeCell(result.fullName),
        safeCell(result.headline),
        result.linkedinUrl,
        String(result.confidence),
        safeCell(result.reasoning),
        ...detail,
      ]);
    });
  });
  return Papa.unparse({ fields: detailed ? [...EXPORT_COLUMNS, ...DETAIL_COLUMNS] : EXPORT_COLUMNS, data }, { newline: '\r\n' });
}

/** Triggers a browser download of a text file. */
export function downloadTextFile(fileName: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  // The BOM makes Excel open UTF-8 (e.g. Cyrillic names) correctly.
  const blob = new Blob(['\uFEFF', content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
