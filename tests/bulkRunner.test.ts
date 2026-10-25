import { describe, expect, it } from 'vitest';
import { createDemoBackend } from '../src/lib/backend/demoBackend';
import { collectExportRows, runBulkJob } from '../src/lib/bulkRunner';
import { buildResultsCsv, parseBulkCsv } from '../src/lib/csv';

const CSV = `company_url,position
stripe.com,CFO
nimbus-labs.example,CTO
quietpine.example,Head of Marketing
search-down.example,CTO
not a website,CEO
acme.io,CTO
brightloop.example,CEO
empty.example,CTO
stripe.com,CFO
orbitly.io,Head of People
`;

async function setup(options: { maxSearchesPerHour?: number } = {}) {
  const backend = createDemoBackend({ latencyScale: 0, ...options });
  await backend.auth.signUp(`user${Math.random()}@example.com`, 'password123');
  const { rows } = parseBulkCsv(CSV);
  const job = await backend.bulk.createJob(
    'test.csv',
    rows.map((r) => ({ companyUrl: r.companyUrl, position: r.position, error: r.error })),
  );
  return { backend, job };
}

describe('bulk runner (demo backend, no latency)', () => {
  it('processes every row, survives bad rows and exports a correct CSV', async () => {
    const { backend, job } = await setup();
    expect(job.totalRows).toBe(10);
    expect(job.processedRows).toBe(1); // the invalid row is failed up front

    const progress: number[] = [];
    const run = await runBulkJob(backend, job.id, { onProgress: (done) => progress.push(done) });
    expect(run.outcome).toBe('completed');
    expect(progress.at(-1)).toBe(10);

    const rows = await backend.bulk.listRows(job.id);
    expect(rows.filter((r) => r.status === 'completed')).toHaveLength(8);
    expect(
      rows
        .filter((r) => r.status === 'failed')
        .map((r) => r.companyUrl)
        .sort(),
    ).toEqual(['not a website', 'search-down.example']);
    expect((await backend.bulk.getJob(job.id))?.status).toBe('completed');

    const exportRows = await collectExportRows(backend, job.id);
    expect(exportRows).toHaveLength(10);
    expect(exportRows[0]?.companyName).toBe('Stripe');
    expect(exportRows[0]?.results.length).toBeGreaterThan(0);
    const csv = buildResultsCsv(exportRows).trim().split(/\r?\n/);
    // Rows without results (failed, empty) still appear once with empty fields.
    expect(csv.filter((line) => line.startsWith('empty.example,CTO,'))).toHaveLength(1);
    expect(csv.filter((line) => line.startsWith('search-down.example,CTO,'))).toHaveLength(1);

    // The repeated stripe.com row was served from cache.
    const history = await backend.history.list();
    expect(history.filter((s) => s.domain === 'stripe.com' && s.fromCache)).toHaveLength(1);
  });

  it('can stop part-way and resume later from the saved rows', async () => {
    const { backend, job } = await setup();
    let done = 0;
    const first = await runBulkJob(backend, job.id, { onRowDone: () => done++, shouldStop: () => done >= 3 });
    expect(first.outcome).toBe('stopped');
    const afterFirst = await backend.bulk.getJob(job.id);
    expect(afterFirst?.processedRows).toBeLessThan(10);
    expect(afterFirst?.status).toBe('running');

    // Simulate a page refresh: a fresh run picks up the unfinished rows.
    const second = await runBulkJob(backend, job.id);
    expect(second.outcome).toBe('completed');
    expect((await backend.bulk.getJob(job.id))?.processedRows).toBe(10);
  });

  it('pauses instead of failing rows when the hourly limit is reached', async () => {
    const { backend, job } = await setup({ maxSearchesPerHour: 3 });
    const run = await runBulkJob(backend, job.id);
    expect(run.outcome).toBe('paused_rate_limit');
    expect(run.message).toMatch(/limit/);
    const rows = await backend.bulk.listRows(job.id);
    expect(rows.some((r) => r.status === 'pending')).toBe(true);
    expect(rows.filter((r) => r.status === 'failed').every((r) => !/limit/.test(r.error ?? ''))).toBe(true);
  });
});
