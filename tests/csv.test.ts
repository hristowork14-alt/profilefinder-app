import { describe, expect, it } from 'vitest';
import { DEMO_TEMPLATE_CSV, MAX_BULK_ROWS, TEMPLATE_CSV, buildResultsCsv, parseBulkCsv, type ExportRow } from '../src/lib/csv';

describe('parseBulkCsv', () => {
  it('parses the standard header', () => {
    const { rows, fileError } = parseBulkCsv('company_url,position\nhttps://stripe.com,CFO\nacme.io,Head of Marketing\n');
    expect(fileError).toBeNull();
    expect(rows).toEqual([
      { index: 0, companyUrl: 'https://stripe.com', position: 'CFO', error: null },
      { index: 1, companyUrl: 'acme.io', position: 'Head of Marketing', error: null },
    ]);
  });

  it('accepts company,title aliases, odd casing, a BOM, quotes and blank lines', () => {
    const { rows, fileError } = parseBulkCsv('\uFEFFCompany, Title \n"stripe.com","VP, Finance"\n\n  acme.io ,  CTO  \n');
    expect(fileError).toBeNull();
    expect(rows.map((r) => [r.companyUrl, r.position])).toEqual([
      ['stripe.com', 'VP, Finance'],
      ['acme.io', 'CTO'],
    ]);
  });

  it('accepts semicolon-separated files (Excel in many EU locales)', () => {
    const { rows, fileError } = parseBulkCsv('company_url;position\nstripe.com;CFO\n');
    expect(fileError).toBeNull();
    expect(rows[0]).toMatchObject({ companyUrl: 'stripe.com', position: 'CFO' });
  });

  it('flags invalid rows individually without rejecting the file', () => {
    const { rows, fileError } = parseBulkCsv('company_url,position\nstripe.com,CFO\nnot a domain,CTO\nacme.io,X\n,CEO\n');
    expect(fileError).toBeNull();
    expect(rows[0]?.error).toBeNull();
    expect(rows[1]?.error).toMatch(/website/i);
    expect(rows[2]?.error).toMatch(/position/i);
    expect(rows[3]?.error).toMatch(/website/i);
  });

  it('rejects files without the required columns', () => {
    expect(parseBulkCsv('name,email\nJane,j@x.io\n').fileError).toMatch(/company_url/);
    expect(parseBulkCsv('').fileError).toMatch(/empty/i);
    expect(parseBulkCsv('company_url,position\n').fileError).toMatch(/no rows/i);
  });

  it(`rejects files with more than ${MAX_BULK_ROWS} rows`, () => {
    const body = Array.from({ length: MAX_BULK_ROWS + 1 }, (_, i) => `c${i}.io,CTO`).join('\n');
    expect(parseBulkCsv(`company_url,position\n${body}`).fileError).toMatch(/100/);
    const ok = Array.from({ length: MAX_BULK_ROWS }, (_, i) => `c${i}.io,CTO`).join('\n');
    expect(parseBulkCsv(`company_url,position\n${ok}`).rows).toHaveLength(MAX_BULK_ROWS);
  });

  it('ships templates that parse cleanly', () => {
    for (const template of [TEMPLATE_CSV, DEMO_TEMPLATE_CSV]) {
      const { rows, fileError } = parseBulkCsv(template);
      expect(fileError).toBeNull();
      expect(rows.length).toBeGreaterThan(2);
      expect(rows.every((r) => r.error === null)).toBe(true);
    }
  });
});

describe('buildResultsCsv', () => {
  it('writes one line per result and keeps rows without results', () => {
    const rows: ExportRow[] = [
      {
        companyUrl: 'stripe.com',
        position: 'CFO',
        companyName: 'Stripe',
        results: [
          {
            fullName: 'Jane Doe',
            headline: 'CFO, Stripe',
            linkedinUrl: 'https://www.linkedin.com/in/jane-doe',
            confidence: 91,
            reasoning: 'Current CFO.',
          },
          {
            fullName: 'Bob "Bobby" Roe',
            headline: 'VP Finance',
            linkedinUrl: 'https://www.linkedin.com/in/bob-roe',
            confidence: 70,
            reasoning: 'Equivalent title.',
          },
        ],
      },
      { companyUrl: 'empty.example', position: 'CTO', companyName: null, results: [] },
    ];
    const csv = buildResultsCsv(rows);
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toBe(
      'company_url,position,company_name,rank,full_name,headline,linkedin_url,confidence,reasoning,row,status,verified_person,source_url,source_quote',
    );
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(
      'stripe.com,CFO,Stripe,1,Jane Doe,"CFO, Stripe",https://www.linkedin.com/in/jane-doe,91,Current CFO.,1,Match found,,,',
    );
    expect(lines[2]).toContain('"Bob ""Bobby"" Roe"');
    expect(lines[3]).toBe('empty.example,CTO,,,,,,,,2,Not found,,,');
  });

  it('adds the status, the verified person and the best source with what it says', () => {
    const csv = buildResultsCsv([
      {
        companyUrl: 'voltra.com',
        position: 'CEO',
        companyName: 'Voltra',
        results: [],
        status: 'completed',
        rowNumber: 7,
        verifiedHolder: {
          name: 'Elle Marsk',
          sources: 2,
          sourceLinks: [{ title: 'Leadership', url: 'https://ir.voltra.com/l', quote: 'Elle Marsk, CEO.' }],
        },
        decision: 'verified_no_profile',
      },
    ]);
    expect(csv.trim().split(/\r?\n/)[1]).toBe(
      'voltra.com,CEO,Voltra,,,,,,,7,Verified — no LinkedIn found,Elle Marsk,https://ir.voltra.com/l,"Elle Marsk, CEO."',
    );
  });

  it('neutralizes spreadsheet formulas in exported text', () => {
    const csv = buildResultsCsv([{ companyUrl: 'x.io', position: '=HYPERLINK("evil")', companyName: '+cmd', results: [] }]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+cmd");
  });
});
