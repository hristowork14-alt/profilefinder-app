import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { ExportRow } from '../src/lib/csv';
import { HEADER_ROW, buildResultsWorkbook } from '../src/lib/xlsxExport';

// Fictional people; the shapes match real bulk rows (verified profile, verified holder without a
// profile, unverified match, nothing found, failed row).
const rows: ExportRow[] = [
  {
    companyUrl: 'orbitly.com',
    position: 'CEO',
    companyName: 'Orbitly',
    status: 'completed',
    results: [
      {
        fullName: 'Andy Corwin',
        headline: 'President and CEO at Orbitly',
        linkedinUrl: 'https://www.linkedin.com/in/andycorwin',
        confidence: 98,
        reasoning: 'Named by 9 independent sources.',
        verified: true,
      },
    ],
    verifiedHolder: {
      name: 'Andy Corwin',
      sources: 3,
      sourceLinks: [{ title: 'Leadership | Orbitly', url: 'https://ir.orbitly.com/l', quote: 'Andy Corwin, President and CEO.' }],
    },
    decision: 'verified_profile',
    rowNumber: 1,
  },
  {
    companyUrl: 'voltra.com',
    position: 'CEO',
    companyName: 'Voltra',
    status: 'completed',
    results: [],
    verifiedHolder: {
      name: 'Elle Marsk',
      sources: 10,
      sourceLinks: [
        { title: 'Voltra leadership', url: 'https://ir.voltra.com/leadership' },
        { title: 'bad', url: 'javascript:alert(1)' },
      ],
    },
    decision: 'verified_no_profile',
    rowNumber: 2,
  },
  {
    companyUrl: 'quietpine.example',
    position: 'Head of Marketing',
    companyName: 'Quiet Pine',
    status: 'completed',
    results: [
      {
        fullName: 'Mara Velin',
        headline: '=HYPERLINK("http://evil")',
        linkedinUrl: 'https://www.linkedin.com/in/maravelin',
        confidence: 62,
        reasoning: 'Headline mentions the role.',
        verified: false,
      },
      {
        fullName: 'Jon Hale',
        headline: 'Marketing',
        linkedinUrl: 'https://www.linkedin.com/in/jonhale',
        confidence: 55,
        reasoning: 'Related title.',
        verified: false,
      },
    ],
    verifiedHolder: null,
    decision: 'unverified',
    rowNumber: 3,
  },
  {
    companyUrl: 'empty.example',
    position: 'CTO',
    companyName: 'Empty',
    status: 'completed',
    results: [],
    verifiedHolder: null,
    decision: 'no_results',
    rowNumber: 4,
  },
  {
    companyUrl: 'not a website',
    position: 'CEO',
    companyName: null,
    status: 'failed',
    error: 'Enter a valid company website.',
    results: [],
    rowNumber: 5,
  },
  {
    companyUrl: 'kelvin.example',
    position: 'CTO',
    companyName: 'Kelvin',
    status: 'completed',
    results: [
      {
        fullName: 'Ian Brask',
        headline: 'CTO at Quillstone',
        linkedinUrl: 'https://www.linkedin.com/in/ianbrask',
        confidence: 60,
        reasoning: 'Sources name Ian Brask as CTO at Kelvin, but this LinkedIn profile shows Quillstone.',
        verified: false,
      },
    ],
    verifiedHolder: null,
    decision: 'contradicted',
    rowNumber: 6,
  },
];

const meta = { fileName: 'test-15.csv', exportedAt: new Date('2026-10-26T14:30:00Z') };

/** Column number of a header on a sheet. */
function col(ws: ExcelJS.Worksheet, header: string): number {
  const row = ws.getRow(HEADER_ROW);
  for (let c = 1; c <= ws.columnCount; c++) if (row.getCell(c).value === header) return c;
  throw new Error(`No column "${header}"`);
}

describe('buildResultsWorkbook', () => {
  it('has the results, a sheet of rows to review, every match, and a legend', async () => {
    const wb = await buildResultsWorkbook(rows, meta);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Results', 'Needs review', 'All matches', 'How to read']);
  });

  it('puts a summary with the count per status above the table', async () => {
    const ws = (await buildResultsWorkbook(rows, meta)).getWorksheet('Results')!;
    const top = [1, 2, 3, 4].map((r) => String(ws.getRow(r).getCell(1).value ?? '')).join('\n');
    expect(top).toMatch(/test-15\.csv/);
    expect(top).toMatch(/6 rows/);
    expect(top).toMatch(/Verified 1/);
    expect(top).toMatch(/Conflicting information 1/);
    expect(top).toMatch(/Failed 1/);
    expect(top).toMatch(/not opened|never opens/i);
  });

  it('formats the header: bold, filled, frozen, with filters', async () => {
    const ws = (await buildResultsWorkbook(rows, meta)).getWorksheet('Results')!;
    const header = ws.getRow(HEADER_ROW);
    expect(header.getCell(col(ws, 'Company')).font?.bold).toBe(true);
    expect(header.getCell(col(ws, 'Person')).fill).toMatchObject({ type: 'pattern', pattern: 'solid' });
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: HEADER_ROW });
    expect(ws.autoFilter).toBeTruthy();
  });

  it('writes one row per company in file order, with the row number from the file', async () => {
    const ws = (await buildResultsWorkbook(rows, meta)).getWorksheet('Results')!;
    expect(ws.rowCount).toBe(HEADER_ROW + rows.length);
    const first = ws.getRow(HEADER_ROW + 1);
    expect(first.getCell(col(ws, 'Row')).value).toBe(1);
    expect(first.getCell(col(ws, 'Company')).value).toBe('Orbitly');
    expect(first.getCell(col(ws, 'Person')).value).toBe('Andy Corwin');
    expect(first.getCell(col(ws, 'Status')).value).toBe('Verified');
    expect(first.getCell(col(ws, 'Company website')).value).toBe('orbitly.com');
    expect(ws.getRow(HEADER_ROW + 5).getCell(col(ws, 'Company')).value).toBe('not a website');
  });

  it('uses one clear status per row', async () => {
    const ws = (await buildResultsWorkbook(rows, meta)).getWorksheet('Results')!;
    const statuses = rows.map((_, i) => ws.getRow(HEADER_ROW + 1 + i).getCell(col(ws, 'Status')).value);
    expect(statuses).toEqual([
      'Verified',
      'Verified — no LinkedIn found',
      'Possible match — not verified',
      'Not found',
      'Failed',
      'Conflicting information',
    ]);
  });

  it('shows the verified name, a safe source link and what the source says, when there is no LinkedIn profile', async () => {
    const ws = (await buildResultsWorkbook(rows, meta)).getWorksheet('Results')!;
    const row = ws.getRow(HEADER_ROW + 2);
    expect(row.getCell(col(ws, 'Person')).value).toBe('Elle Marsk');
    expect(row.getCell(col(ws, 'LinkedIn profile')).value).toBeNull();
    expect(row.getCell(col(ws, 'Best source')).value).toMatchObject({ hyperlink: 'https://ir.voltra.com/leadership' });
    const first = ws.getRow(HEADER_ROW + 1);
    expect(first.getCell(col(ws, 'What the source says')).value).toBe('Andy Corwin, President and CEO.');
  });

  it('makes LinkedIn URLs clickable and colors confidence by tier', async () => {
    const ws = (await buildResultsWorkbook(rows, meta)).getWorksheet('Results')!;
    const verified = ws.getRow(HEADER_ROW + 1);
    expect(verified.getCell(col(ws, 'LinkedIn profile')).value).toMatchObject({ hyperlink: 'https://www.linkedin.com/in/andycorwin' });
    const confidence = verified.getCell(col(ws, 'Confidence'));
    expect(confidence.value).toBe(98);
    expect(confidence.numFmt).toBe('0"%"');
    const unverified = ws.getRow(HEADER_ROW + 3);
    expect(JSON.stringify(confidence.fill)).not.toBe(JSON.stringify(unverified.getCell(col(ws, 'Confidence')).fill));
  });

  it('draws borders around every data cell', async () => {
    const ws = (await buildResultsWorkbook(rows, meta)).getWorksheet('Results')!;
    for (let r = HEADER_ROW; r <= ws.rowCount; r++) {
      for (let c = 1; c <= ws.columnCount; c++) expect(ws.getCell(r, c).border?.bottom?.style).toBe('thin');
    }
  });

  it('lists only the rows that need a look on "Needs review", keeping their row numbers', async () => {
    const ws = (await buildResultsWorkbook(rows, meta)).getWorksheet('Needs review')!;
    const listed: unknown[] = [];
    for (let r = HEADER_ROW + 1; r <= ws.rowCount; r++) listed.push(ws.getRow(r).getCell(col(ws, 'Row')).value);
    expect(listed).toEqual([3, 4, 5, 6]);
  });

  it('explains every status on "How to read"', async () => {
    const ws = (await buildResultsWorkbook(rows, meta)).getWorksheet('How to read')!;
    const text: string[] = [];
    ws.eachRow((row) => row.eachCell((cell) => text.push(String(cell.value ?? ''))));
    const all = text.join('\n');
    for (const label of ['Verified', 'Possible match — not verified', 'Conflicting information', 'Not found', 'Failed']) {
      expect(all).toContain(label);
    }
    expect(all).toMatch(/LinkedIn/);
  });

  it('keeps formula-looking text as plain text', async () => {
    const ws = (await buildResultsWorkbook(rows, meta)).getWorksheet('All matches')!;
    const cell = ws.getRow(HEADER_ROW + 3).getCell(col(ws, 'Headline'));
    expect(cell.type).toBe(ExcelJS.ValueType.String);
  });

  it('lists every match on the details sheet, with its rank', async () => {
    const ws = (await buildResultsWorkbook(rows, meta)).getWorksheet('All matches')!;
    const names: unknown[] = [];
    for (let r = HEADER_ROW + 1; r <= ws.rowCount; r++) names.push(ws.getRow(r).getCell(col(ws, 'Person')).value);
    expect(names).toEqual(['Andy Corwin', 'Elle Marsk', 'Mara Velin', 'Jon Hale', '—', '—', 'Ian Brask']);
    expect(ws.getRow(HEADER_ROW + 4).getCell(col(ws, 'Rank')).value).toBe(2);
  });

  it('produces a valid .xlsx that Excel can open', async () => {
    const wb = await buildResultsWorkbook(rows, meta);
    const buffer = await wb.xlsx.writeBuffer();
    const reread = new ExcelJS.Workbook();
    await reread.xlsx.load(buffer);
    const ws = reread.getWorksheet('Results')!;
    expect(ws.getRow(HEADER_ROW + 1).getCell(col(ws, 'Person')).value).toBe('Andy Corwin');
  });
});
