import { beforeEach, describe, expect, it } from 'vitest';
import { createSearchHandler } from '../netlify/functions/_lib/handler';
import { createMemoryStore, type MemoryStore } from '../shared/memoryStore';
import { performSearch } from '../shared/searchService';
import { createMockHomepageFetcher, createMockLlmClient, createMockSearchProvider } from '../shared/mocks';
import type { SearchResponse } from '../shared/types';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const tokens: Record<string, string> = { 'token-a': USER_A, 'token-b': USER_B };

let store: MemoryStore;
let handler: (req: Request) => Promise<Response>;

const post = (body: unknown, token: string | null = 'token-a') =>
  handler(
    new Request('http://localhost/.netlify/functions/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  store = createMemoryStore();
  handler = createSearchHandler({
    authenticate: async (req) => {
      const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
      const id = tokens[token];
      return id ? { id } : null;
    },
    store,
    pipelineDeps: () => ({
      searchProvider: createMockSearchProvider({ latencyScale: 0 }),
      fetchHomepage: createMockHomepageFetcher({ latencyScale: 0 }),
      llm: createMockLlmClient({ latencyScale: 0 }),
    }),
    config: { maxSearchesPerHour: 3, cacheTtlMs: 7 * 24 * 3600 * 1000 },
  });
});

describe('search function handler', () => {
  it('returns 401 without a valid token', async () => {
    expect((await post({ companyUrl: 'stripe.com', position: 'CFO' }, null)).status).toBe(401);
    expect((await post({ companyUrl: 'stripe.com', position: 'CFO' }, 'wrong')).status).toBe(401);
  });

  it('returns 405 for non-POST requests', async () => {
    const res = await handler(new Request('http://localhost/.netlify/functions/search', { method: 'GET' }));
    expect(res.status).toBe(405);
  });

  it('returns 400 with a readable message for invalid input', async () => {
    for (const body of [
      { companyUrl: 'not a url', position: 'CFO' },
      { companyUrl: 'stripe.com', position: 'C' },
      { companyUrl: 'stripe.com' },
      '{bad json',
      { companyUrl: 'stripe.com', position: 'x'.repeat(101) },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string; code: string };
      expect(json.code).toBe('invalid_input');
      expect(json.error).not.toMatch(/stack|at Object/i);
    }
  });

  it('runs the full pipeline, saves the search and serves the repeat from cache', async () => {
    const first = await post({ companyUrl: 'https://www.stripe.com/about', position: 'CFO' });
    expect(first.status).toBe(200);
    const body = (await first.json()) as SearchResponse;
    expect(body.domain).toBe('stripe.com');
    expect(body.companyName).toBe('Stripe');
    expect(body.fromCache).toBe(false);
    expect(body.results.length).toBeGreaterThanOrEqual(1);
    expect(body.results.length).toBeLessThanOrEqual(5);
    for (const r of body.results) {
      expect(r.linkedinUrl).toMatch(/^https:\/\/www\.linkedin\.com\/in\/[^/?#]+$/);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.reasoning.length).toBeGreaterThan(0);
    }
    expect(store.searches).toHaveLength(1);
    expect(store.searches[0]?.results).toHaveLength(body.results.length);

    const again = (await (await post({ companyUrl: 'stripe.com', position: ' cfo ' })).json()) as SearchResponse;
    expect(again.fromCache).toBe(true);
    expect(again.results).toEqual(body.results);
    expect(store.searches).toHaveLength(2);
    expect(store.searches[1]?.fromCache).toBe(true);
  });

  it('returns 429 after the hourly limit, but cached searches still work', async () => {
    for (const domain of ['a-one.example', 'a-two.example', 'a-three.example']) {
      expect((await post({ companyUrl: domain, position: 'CTO' })).status).toBe(200);
    }
    const limited = await post({ companyUrl: 'a-four.example', position: 'CTO' });
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { code: string }).code).toBe('rate_limited');
    expect((await post({ companyUrl: 'a-one.example', position: 'CTO' })).status).toBe(200);
    // Another user has their own budget.
    expect((await post({ companyUrl: 'a-four.example', position: 'CTO' }, 'token-b')).status).toBe(200);
  });

  it('does not count searches that failed on our side against the hourly limit', async () => {
    for (let i = 0; i < 3; i++) expect((await post({ companyUrl: 'search-down.example', position: 'CTO' })).status).toBe(502);
    expect((await post({ companyUrl: 'a-one.example', position: 'CTO' })).status).toBe(200);
  });

  it('also enforces a daily limit, with its own message', async () => {
    const daily = createSearchHandler({
      authenticate: async () => ({ id: USER_A }),
      store,
      pipelineDeps: () => ({
        searchProvider: createMockSearchProvider({ latencyScale: 0 }),
        fetchHomepage: createMockHomepageFetcher({ latencyScale: 0 }),
        llm: createMockLlmClient({ latencyScale: 0 }),
      }),
      config: { maxSearchesPerHour: 100, maxSearchesPerDay: 2, cacheTtlMs: 7 * 24 * 3600 * 1000 },
    });
    const call = (companyUrl: string) =>
      daily(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ companyUrl, position: 'CTO' }) }));
    expect((await call('d-one.example')).status).toBe(200);
    expect((await call('d-two.example')).status).toBe(200);
    const limited = await call('d-three.example');
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: string }).error).toMatch(/per day/);
  });

  it('returns an empty list with a friendly message when nothing is found', async () => {
    const body = (await (await post({ companyUrl: 'empty.example', position: 'CTO' })).json()) as SearchResponse;
    expect(body.results).toEqual([]);
    expect(body.message).toMatch(/No matching profiles found/);
    expect(store.searches[0]?.status).toBe('no_results');
  });

  it('records a failed search and returns 502 when the search API is down', async () => {
    const res = await post({ companyUrl: 'search-down.example', position: 'CTO' });
    expect(res.status).toBe(502);
    expect(store.searches[0]?.status).toBe('failed');
  });

  it('rejects a bulk job that belongs to someone else', async () => {
    const jobId = store.createBulkJob(USER_B);
    expect((await post({ companyUrl: 'stripe.com', position: 'CFO', bulkJobId: jobId }, 'token-a')).status).toBe(400);
    const ok = await post({ companyUrl: 'stripe.com', position: 'CFO', bulkJobId: jobId }, 'token-b');
    expect(ok.status).toBe(200);
    expect(store.searches.at(-1)?.bulkJobId).toBe(jobId);
  });

  // An empty answer may be a temporary miss (or, as seen in production, a wrongly resolved
  // company name), so it must not lock that company + role out for the 7-day cache window.
  it('does not cache an empty result', async () => {
    await post({ companyUrl: 'empty.example', position: 'CTO' });
    const second = (await (await post({ companyUrl: 'empty.example', position: 'CTO' })).json()) as SearchResponse;
    expect(second.fromCache).toBe(false);
    expect(store.searches[1]?.fromCache).toBe(false);
  });

  it('ignores an empty cache entry written earlier and searches again', async () => {
    await store.putCached({ domain: 'stripe.com', positionNormalized: 'cfo', companyName: 'Stripe', results: [] });
    const body = (await (await post({ companyUrl: 'stripe.com', position: 'CFO' })).json()) as SearchResponse;
    expect(body.fromCache).toBe(false);
    expect(body.results.length).toBeGreaterThan(0);
  });

  it('ignores cache entries written before the pipeline last changed (cacheValidAfter)', async () => {
    const fixedNow = new Date('2026-10-26T12:00:00Z');
    const outcome = await performSearch(
      USER_A,
      { companyUrl: 'stripe.com', position: 'CFO' },
      {
        store,
        pipelineDeps: {
          searchProvider: createMockSearchProvider({ latencyScale: 0 }),
          fetchHomepage: createMockHomepageFetcher({ latencyScale: 0 }),
          llm: createMockLlmClient({ latencyScale: 0 }),
        },
        config: { maxSearchesPerHour: 3, cacheTtlMs: 7 * 24 * 3600 * 1000, cacheValidAfter: fixedNow.getTime() + 60_000 },
        now: () => fixedNow,
      },
    );
    // Written "now", i.e. before the cut-off: a repeat must not be served from it.
    expect(outcome.status).toBe(200);
    const again = await performSearch(
      USER_A,
      { companyUrl: 'stripe.com', position: 'CFO' },
      {
        store,
        pipelineDeps: {
          searchProvider: createMockSearchProvider({ latencyScale: 0 }),
          fetchHomepage: createMockHomepageFetcher({ latencyScale: 0 }),
          llm: createMockLlmClient({ latencyScale: 0 }),
        },
        config: { maxSearchesPerHour: 3, cacheTtlMs: 7 * 24 * 3600 * 1000, cacheValidAfter: fixedNow.getTime() + 60_000 },
        now: () => fixedNow,
      },
    );
    expect(again.status === 200 && again.body.fromCache).toBe(false);
  });

  it('does not cache heuristic fallback results', async () => {
    await post({ companyUrl: 'flaky-ai.example', position: 'CEO' });
    const second = (await (await post({ companyUrl: 'flaky-ai.example', position: 'CEO' })).json()) as SearchResponse;
    expect(second.fromCache).toBe(false);
    expect(second.rankedBy).toBe('heuristic');
  });
});
