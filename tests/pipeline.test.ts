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

  it('does not add evidence queries unless corroboration is switched on (demo and mocks unchanged)', async () => {
    const result = await runSearchPipeline({ domain: 'nimbus-labs.example', position: 'CTO' }, fastMocks());
    expect(result.queries.every((q) => q.startsWith('site:linkedin.com/in'))).toBe(true);
    expect(result.evidence).toEqual([]);
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

// What production showed for cloudflare.com + CTO, with fictional people: the title queries
// only return self-declared profiles, while the open web names the real holder.
describe('runSearchPipeline with corroboration', () => {
  const evidenceHits: SearchHit[] = [
    {
      title: "Who is the CTO of Northwind in 2026? Mara Velin's Bio",
      snippet: 'Mara Velin is the Chief Technology Officer of Northwind.',
      url: 'https://dossier.example/a',
    },
    {
      title: 'Northwind names Mara Velin Chief Technology Officer',
      snippet: 'Northwind today announced that Mara Velin has become CTO.',
      url: 'https://news.example/b',
    },
  ];
  const selfDeclared: SearchHit = {
    title: 'zed fakeman - Chief Technology Officer at Northwind | LinkedIn',
    snippet: 'Chief Technology Officer at Northwind · Experience: Northwind · Location: Nowhere · 1 follower',
    url: 'https://www.linkedin.com/in/zed-fakeman-57a92138b',
  };
  const realProfile: SearchHit = {
    title: 'Mara Velin - Northwind | LinkedIn',
    snippet: 'Experience: Northwind · Location: San Francisco · 500+ connections on LinkedIn.',
    url: 'https://www.linkedin.com/in/maravelin',
  };

  const provider = (seen: string[]): SearchProvider => ({
    name: 'test',
    search: async (query) => {
      seen.push(query);
      if (query.includes('-site:linkedin.com')) return evidenceHits;
      if (query.includes('"Mara Velin"')) return [realProfile];
      return [selfDeclared];
    },
  });

  const run = (seen: string[], llm: LlmClient | null = null) =>
    runSearchPipeline(
      { domain: 'northwind.com', position: 'CTO' },
      { searchProvider: provider(seen), fetchHomepage: async () => '<title>Northwind</title>', llm, corroborate: true },
    );

  it('looks up the person independent sources name, and ranks them above a self-declared profile', async () => {
    const seen: string[] = [];
    const result = await run(seen);
    expect(seen).toContain('"Northwind" "CTO" -site:linkedin.com');
    expect(seen).toContain('site:linkedin.com/in "Mara Velin" "Northwind"');
    expect(result.evidence).toEqual([{ name: 'Mara Velin', sources: 2 }]);
    expect(result.results[0]?.fullName).toBe('Mara Velin');
    expect(result.results[0]?.linkedinUrl).toBe('https://www.linkedin.com/in/maravelin');
    const fake = result.results.find((r) => r.fullName === 'zed fakeman');
    expect(fake === undefined || fake.confidence < 50).toBe(true);
  });

  it('tells Claude which candidates independent sources confirm', async () => {
    const prompts: string[] = [];
    const llm: LlmClient = {
      complete: async ({ prompt }) => {
        prompts.push(prompt);
        return JSON.stringify({
          results: [
            { fullName: 'Mara Velin', headline: 'Northwind', linkedinUrl: realProfile.url, confidence: 92, reasoning: 'Named by sources.' },
          ],
        });
      },
    };
    const result = await run([], llm);
    expect(result.rankedBy).toBe('claude');
    expect(prompts[0]).toMatch(/Independent web sources/);
    expect(prompts[0]).toMatch(/Mara Velin \(2 sources\)/);
    expect(prompts[0]).toMatch(/"namedByIndependentSources": 2/);
  });
});
