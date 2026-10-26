import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { ExportRow } from '../src/lib/csv';
import { HEADER_ROW, buildResultsWorkbook, resultStatus } from '../src/lib/xlsxExport';

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
    verifiedHolder: { name: 'Andy Corwin', sources: 9, sourceLinks: [{ title: 'Leadership | Orbitly', url: 'https://ir.orbitly.com/l' }] },
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
  },
  { companyUrl: 'empty.example', position: 'CTO', companyName: 'Empty', status: 'completed', results: [], verifiedHolder: null },
  {
    companyUrl: 'not a website',
    position: 'CEO',
    companyName: null,
    status: 'failed',
    error: 'Enter a valid company website.',
    results: [],
  },
];

const meta = { fileName: 'test-15.csv', exportedAt: new Date('2026-10-26T14:30:00Z') };

describe('resultStatus', () => {
  it('describes every kind of row in plain words', () => {
    expect(resultStatus(rows[0]!).label).toBe('Verified by 9 sources');
    expect(resultStatus(rows[1]!).label).toBe('Verified · no public LinkedIn profile');
    expect(resultStatus(rows[2]!).label).toBe('Not independently verified');
    expect(resultStatus(rows[3]!).label).toBe('No match found');
    expect(resultStatus(rows[4]!).label).toBe('Failed');
  });
});

describe('buildResultsWorkbook', () => {
  it('has a readable summary sheet and a details sheet', async () => {
    const wb = await buildResultsWorkbook(rows, meta);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Results', 'All matches']);
  });

  it('formats the header: bold, filled, frozen, with filters', async () => {
    const ws = (await buildResultsWorkbook(rows, meta)).getWorksheet('Results')!;
    const header = ws.getRow(HEADER_ROW);
    expect(header.getCell(2).value).toBe('Company website');
    expect(header.getCell(5).value).toBe('Person');
    expect(header.getCell(2).font?.bold).toBe(true);
    expect(header.getCell(2).fill).toMatchObject({ type: 'pattern', pattern: 'solid' });
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: HEADER_ROW });
    expect(ws.autoFilter).toBeTruthy();
  });

  it('writes one row per company, in file order, with the important columns in bold', async () => {
    const ws = (await buildResultsWorkbook(rows, meta)).getWorksheet('Results')!;
    const first = ws.getRow(HEADER_ROW + 1);
    expect(first.getCell(2).value).toBe('orbitly.com');
    expect(first.getCell(5).value).toBe('Andy Corwin');
    for (const col of [2, 3, 5]) expect(first.getCell(col).font?.bold).toBe(true);
    expect(ws.getRow(HEADER_ROW + 5).getCell(2).value).toBe('not a website');
    expect(ws.rowCount).toBe(HEADER_ROW + rows.length);
  });

  it('shows the verified name, and a safe source link, when there is no LinkedIn profile', async () => {
    const ws = (await buildResultsWorkbook(rows, meta)).getWorksheet('Results')!;
    const row = ws.getRow(HEADER_ROW + 2);
    expect(row.getCell(5).value).toBe('Elle Marsk');
    expect(row.getCell(6).value).toBe('Verified · no public LinkedIn profile');
    expect(row.getCell(8).value).toBeNull();
    expect(row.getCell(10).value).toMatchObject({ hyperlink: 'https://ir.voltra.com/leadership' });
  });

  it('makes LinkedIn URLs clickable and colors confidence by tier', async () => {
    const ws = (await buildResultsWorkbook(rows, meta)).getWorksheet('Results')!;
    const verified = ws.getRow(HEADER_ROW + 1);
    expect(verified.getCell(8).value).toMatchObject({ hyperlink: 'https://www.linkedin.com/in/andycorwin' });
    expect(verified.getCell(7).value).toBe(98);
    expect(verified.getCell(7).numFmt).toBe('0"%"');
    const unverified = ws.getRow(HEADER_ROW + 3);
    expect(JSON.stringify(verified.getCell(7).fill)).not.toBe(JSON.stringify(unverified.getCell(7).fill));
  });

  it('draws borders around every data cell', async () => {
    const ws = (await buildResultsWorkbook(rows, meta)).getWorksheet('Results')!;
    for (let r = HEADER_ROW; r <= ws.rowCount; r++) {
      for (let c = 1; c <= ws.columnCount; c++) expect(ws.getCell(r, c).border?.bottom?.style).toBe('thin');
    }
  });

  it('keeps formula-looking text as plain text', async () => {
    const ws = (await buildResultsWorkbook(rows, meta)).getWorksheet('All matches')!;
    const cell = ws.getRow(HEADER_ROW + 3).getCell(6);
    expect(cell.type).toBe(ExcelJS.ValueType.String);
  });

  it('lists every match on the details sheet, with its rank', async () => {
    const ws = (await buildResultsWorkbook(rows, meta)).getWorksheet('All matches')!;
    const names: unknown[] = [];
    for (let r = HEADER_ROW + 1; r <= ws.rowCount; r++) names.push(ws.getRow(r).getCell(5).value);
    expect(names).toEqual(['Andy Corwin', 'Elle Marsk', 'Mara Velin', 'Jon Hale', '—', '—']);
    expect(ws.getRow(HEADER_ROW + 4).getCell(4).value).toBe(2);
  });

  it('produces a valid .xlsx that Excel can open', async () => {
    const wb = await buildResultsWorkbook(rows, meta);
    const buffer = await wb.xlsx.writeBuffer();
    const reread = new ExcelJS.Workbook();
    await reread.xlsx.load(buffer);
    expect(
      reread
        .getWorksheet('Results')!
        .getRow(HEADER_ROW + 1)
        .getCell(5).value,
    ).toBe('Andy Corwin');
  });
});
