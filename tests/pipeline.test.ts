import { describe, expect, it } from 'vitest';
import { SearchUnavailableError, runSearchPipeline } from '../shared/pipeline';
import { createMockHomepageFetcher, createMockLlmClient, createMockSearchProvider } from '../shared/mocks';
import type { LlmClient, SearchHit, SearchProvider } from '../shared/types';

const fastMocks = () => ({
  searchProvider: createMockSearchProvider({ latencyScale: 0 }),
  fetchHomepage: createMockHomepageFetcher({ latencyScale: 0 }),
  llm: createMockLlmClient({ latencyScale: 0 }),
});

describe('runSearchPipeline with mock providers', () => {
  it('runs input → candidates → ranked results end to end', async () => {
    const steps: string[] = [];
    const result = await runSearchPipeline(
      { domain: 'nimbus-labs.example', position: 'CTO' },
      { ...fastMocks(), onProgress: (step) => steps.push(step) },
    );
    expect(result.companyName).toBe('Nimbus Labs');
    expect(result.companySource).toBe('og:site_name');
    expect(result.queries).toHaveLength(3);
    expect(result.candidates.length).toBeGreaterThan(3);
    // Non-profile URLs are filtered out and duplicates removed.
    expect(result.candidates.every((c) => c.linkedinUrl.startsWith('https://www.linkedin.com/in/'))).toBe(true);
    expect(new Set(result.candidates.map((c) => c.slug)).size).toBe(result.candidates.length);
    expect(result.rankedBy).toBe('claude');
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.results.length).toBeLessThanOrEqual(5);
    const candidateUrls = new Set(result.candidates.map((c) => c.linkedinUrl));
    expect(result.results.every((r) => candidateUrls.has(r.linkedinUrl))).toBe(true);
    expect(steps).toEqual(['company', 'search', 'rank']);
  });

  it('falls back to the domain name when the homepage cannot be fetched', async () => {
    const result = await runSearchPipeline({ domain: 'stripe.com', position: 'CFO' }, fastMocks());
    expect(result.companyName).toBe('Stripe');
    expect(result.companySource).toBe('domain');
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('falls back to the heuristic ranker when the model returns invalid JSON twice', async () => {
    const result = await runSearchPipeline({ domain: 'flaky-ai.example', position: 'CEO' }, fastMocks());
    expect(result.rankedBy).toBe('heuristic');
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('uses the heuristic ranker when no model is configured', async () => {
    const result = await runSearchPipeline({ domain: 'acme.io', position: 'CTO' }, { ...fastMocks(), llm: null });
    expect(result.rankedBy).toBe('heuristic');
  });

  it('returns an empty list when nothing is found', async () => {
    const result = await runSearchPipeline({ domain: 'empty.example', position: 'CTO' }, fastMocks());
    expect(result.results).toEqual([]);
    expect(result.candidates).toEqual([]);
  });

  it('throws SearchUnavailableError when every search query fails', async () => {
    await expect(runSearchPipeline({ domain: 'search-down.example', position: 'CTO' }, fastMocks())).rejects.toBeInstanceOf(
      SearchUnavailableError,
    );
  });

  it('respects the overall deadline: a slow model is abandoned for the heuristic ranker', async () => {
    const slowLlm: LlmClient = {
      complete: ({ signal }) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve('{"results": []}'), 5000);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          });
        }),
    };
    const started = Date.now();
    const result = await runSearchPipeline(
      { domain: 'acme.io', position: 'CTO' },
      { ...fastMocks(), llm: slowLlm, timing: { totalMs: 600, homepageMs: 100, searchMs: 100, llmMs: 5000, minLlmMs: 100 } },
    );
    expect(Date.now() - started).toBeLessThan(1500);
    expect(result.rankedBy).toBe('heuristic');
  });

  it('times out a hanging search query without failing the others', async () => {
    const hits: SearchHit[] = [
      { title: 'Jane Doe - CTO - Acme | LinkedIn', snippet: 'CTO at Acme', url: 'https://www.linkedin.com/in/jane-doe' },
    ];
    const provider: SearchProvider = {
      name: 'test',
      search: (query, { signal }) =>
        query.includes('"acme.io"')
          ? new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
          : Promise.resolve(hits),
    };
    const result = await runSearchPipeline(
      { domain: 'acme.io', position: 'CTO' },
      {
        ...fastMocks(),
        searchProvider: provider,
        llm: null,
        timing: { totalMs: 2000, homepageMs: 100, searchMs: 150, llmMs: 500, minLlmMs: 100 },
      },
    );
    expect(result.searchErrors).toBe(1);
    expect(result.results[0]?.fullName).toBe('Jane Doe');
  });
});
