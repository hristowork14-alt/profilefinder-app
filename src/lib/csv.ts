// CSV parsing/validation for bulk search and the results export (papaparse).

import Papa from 'papaparse';
import { parseCompanyUrl } from '@shared/domain';
import type { RankedProfile, VerifiedHolder } from '@shared/types';
import { sanitizeText } from '@shared/validation';

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
    let error: string | null = null;
    if (!companyUrl) error = 'Missing company website.';
    else {
      const company = parseCompanyUrl(companyUrl);
      if (!company.ok) error = company.error;
    }
    if (!error && position.length < 2) error = 'Missing position (at least 2 characters, e.g. CTO).';
    if (!error && position.length > 100) error = 'The position must be 100 characters or fewer.';
    return { index, companyUrl: companyUrl.slice(0, 500), position: position.slice(0, 200), error };
  });

  return { rows, fileError: null };
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

/** Prevents CSV formula injection when the file is opened in Excel / Google Sheets. */
function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function buildResultsCsv(rows: ExportRow[]): string {
  const data: string[][] = [];
  for (const row of rows) {
    const base = [safeCell(row.companyUrl), safeCell(row.position), safeCell(row.companyName ?? '')];
    if (row.results.length === 0) {
      data.push([...base, '', '', '', '', '', '']);
      continue;
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
      ]);
    });
  }
  return Papa.unparse({ fields: EXPORT_COLUMNS, data }, { newline: '\r\n' });
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
