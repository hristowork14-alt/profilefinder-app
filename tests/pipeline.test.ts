import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMING, SearchUnavailableError, runSearchPipeline } from '../shared/pipeline';
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
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ name: 'Mara Velin', sources: 2 });
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
    // The first model call is now the evidence extraction; the ranking prompt is the one with candidates.
    const rankingPrompt = prompts.find((p) => p.includes('<candidates>')) ?? '';
    expect(rankingPrompt).toMatch(/Independent web sources/);
    expect(rankingPrompt).toMatch(/Mara Velin \(2 sources\)/);
    expect(rankingPrompt).toMatch(/"namedByIndependentSources": 2/);
  });
});

// Production 2026-10-26: amazon.com + CEO (sources named the real CEO, but his profile wasn't
// found and a self-declared one was shown) and tesla.com + CEO (the real CEO has no LinkedIn
// profile, and the app didn't say who it is). Fictional people, real formats.
describe('runSearchPipeline: multi-strategy verification', () => {
  const evidence: SearchHit[] = [
    {
      title: 'Leadership | Orbitly',
      snippet: 'Andy Corwin, President and Chief Executive Officer.',
      url: 'https://ir.orbitly.com/leadership',
    },
    { title: 'Who is the CEO of Orbitly?', snippet: 'Andy Corwin has been CEO of Orbitly since 2021.', url: 'https://answers.example/b' },
  ];
  const fake: SearchHit = {
    title: 'zed fakeman - Chief Executive Officer at Orbitly | LinkedIn',
    snippet: 'Chief Executive Officer at Orbitly · 0 followers',
    url: 'https://www.linkedin.com/in/zed-fakeman-a13481385',
  };
  const andrew: SearchHit = {
    title: 'Andrew Corwin - Orbitly | LinkedIn',
    snippet: 'President and CEO at Orbitly · Location: Seattle · 500+ connections on LinkedIn.',
    url: 'https://www.linkedin.com/in/andrewcorwin',
  };

  const provider = (seen: string[], profiles: Record<string, SearchHit[]>, evidenceHits = evidence): SearchProvider => ({
    name: 'test',
    search: async (query) => {
      seen.push(query);
      if (query.includes('-site:linkedin.com')) return evidenceHits;
      for (const [needle, hits] of Object.entries(profiles)) if (query.includes(needle)) return hits;
      return [fake];
    },
  });
  const run = (search: SearchProvider, llm: LlmClient | null = null) =>
    runSearchPipeline(
      { domain: 'orbitly.com', position: 'CEO' },
      { searchProvider: search, fetchHomepage: async () => '<title>Orbitly</title>', llm, corroborate: true },
    );

  it('finds the verified person under a nickname form and hides the self-declared profile', async () => {
    const seen: string[] = [];
    const result = await run(provider(seen, { '"Andrew Corwin"': [andrew], '"Andy Corwin"': [] }));
    expect(seen).toContain('who is the Chief Executive Officer of Orbitly -site:linkedin.com');
    expect(seen).toContain('site:linkedin.com/in "Andrew Corwin" "Orbitly"');
    expect(result.results.map((r) => r.linkedinUrl)).toEqual([andrew.url]);
    expect(result.results[0]?.verified).toBe(true);
    expect(result.verifiedHolder?.name).toBe('Andy Corwin');
    expect(result.trace.decision).toBe('verified_profile');
  });

  it('returns the verified name and no profiles when the person has no findable profile', async () => {
    const result = await run(provider([], { '"Andy Corwin"': [], '"Andrew Corwin"': [] }));
    expect(result.results).toEqual([]);
    // Two websites name him: the company's own site and one other. The user is told "2 sources".
    expect(result.verifiedHolder).toMatchObject({ name: 'Andy Corwin', sources: 2 });
    expect(result.verifiedHolder?.sourceLinks[0]?.url).toBe('https://ir.orbitly.com/leadership');
    expect(result.trace.decision).toBe('verified_no_profile');
  });

  it('without a verified holder, shows nothing that looks self-declared', async () => {
    const result = await run(provider([], {}, []));
    expect(result.verifiedHolder).toBeNull();
    expect(result.results).toEqual([]);
    expect(result.trace.decision).toBe('no_results');
  });

  it('uses Claude to read the evidence when available, and records that it agreed with the regex', async () => {
    const llm: LlmClient = {
      complete: async ({ prompt }) =>
        prompt.includes('<candidates>')
          ? JSON.stringify({
              results: [{ fullName: 'Andrew Corwin', headline: 'CEO', linkedinUrl: andrew.url, confidence: 90, reasoning: 'r' }],
            })
          : JSON.stringify({ holder: { name: 'Andy Corwin', isCurrent: true, sourceIds: [1, 2] } }),
    };
    const result = await run(provider([], { '"Andrew Corwin"': [andrew], '"Andy Corwin"': [] }), llm);
    expect(result.trace.extraction).toBe('agree');
    expect(result.results[0]?.verified).toBe(true);
  });

  it('falls back to the regex when the model fails, and never makes more than 2 model calls', async () => {
    let calls = 0;
    const llm: LlmClient = {
      complete: async () => {
        calls++;
        return 'not json';
      },
    };
    const result = await run(provider([], { '"Andrew Corwin"': [andrew], '"Andy Corwin"': [] }), llm);
    expect(calls).toBeLessThanOrEqual(2);
    expect(result.trace.extraction).toBe('regex');
    expect(result.results[0]?.linkedinUrl).toBe(andrew.url);
  });

  it('accepts the profile returned for "<name>" "<company>" even when its snippet is bare, but not a bare namesake', async () => {
    const bare: SearchHit = { title: 'Andy Corwin | LinkedIn', snippet: 'Seattle.', url: 'https://www.linkedin.com/in/andy-corwin' };
    const namesake: SearchHit = { title: 'Andy Corwin | LinkedIn', snippet: 'Leeds.', url: 'https://www.linkedin.com/in/andy-corwin-77' };
    const result = await run(provider([], { '"Andy Corwin" "Orbitly"': [bare], '"Andy Corwin"': [namesake], '"Andrew Corwin"': [] }));
    expect(result.results.map((r) => r.linkedinUrl)).toEqual([bare.url]);
    expect(result.results[0]?.verified).toBe(true);
  });

  it('records the names on the profiles each person lookup returned (names only)', async () => {
    const result = await run(provider([], { '"Andrew Corwin"': [andrew], '"Andy Corwin"': [] }));
    const lookup = result.trace.queries.find((q) => q.query.includes('"Andrew Corwin"'));
    expect(lookup?.profiles).toEqual(['Andrew Corwin']);
    expect(JSON.stringify(result.trace)).not.toMatch(/500\+ connections/);
  });

  // Production 2026-10-26 (shelly.com + CFO): two people tied in the regex reading (the current
  // and the former CFO) and the first one was shown as verified.
  describe('when two people are named equally often', () => {
    const tie: SearchHit[] = [
      { title: 'Orbitly CEO Mara Velin', snippet: '', url: 'https://a.example/1' },
      { title: 'Mara Velin, CEO at Orbitly', snippet: '', url: 'https://b.example/2' },
      { title: 'Orbitly CEO Jon Hale', snippet: '', url: 'https://c.example/3' },
      { title: 'Jon Hale, CEO at Orbitly', snippet: '', url: 'https://d.example/4' },
    ];

    it('does not call either of them verified on the regex reading alone', async () => {
      const result = await run(provider([], {}, tie));
      expect(result.verifiedHolder).toBeNull();
      expect(result.trace.extraction).toBe('tie');
      expect(result.results.every((r) => !r.verified)).toBe(true);
    });

    it('lets Claude decide between them', async () => {
      const llm: LlmClient = {
        complete: async ({ prompt }) =>
          prompt.includes('<candidates>')
            ? JSON.stringify({ results: [] })
            : JSON.stringify({ holder: { name: 'Jon Hale', isCurrent: true, sourceIds: [3, 4] } }),
      };
      const result = await run(provider([], {}, tie), llm);
      expect(result.verifiedHolder?.name).toBe('Jon Hale');
      expect(result.trace.extraction).toBe('claude');
    });
  });

  // Production 2026-10-27 (absurdventures.com + CEO): the regex and Claude named different people
  // and the app picked one — a namesake — as "verified".
  it('does not verify anyone when the regex and Claude name different people', async () => {
    const twoNames: SearchHit[] = [
      { title: 'Orbitly CEO Mara Velin', snippet: '', url: 'https://a.example/1' },
      { title: 'Mara Velin, CEO at Orbitly', snippet: '', url: 'https://b.example/2' },
      { title: 'Orbitly CEO Mara Velin interview', snippet: '', url: 'https://e.example/5' },
      { title: 'Jon Hale leads Orbitly', snippet: 'Jon Hale runs Orbitly as chief executive.', url: 'https://c.example/3' },
      { title: 'Orbitly update', snippet: 'Jon Hale, who runs Orbitly, said…', url: 'https://d.example/4' },
    ];
    const llm: LlmClient = {
      complete: async ({ prompt }) =>
        prompt.includes('<candidates>')
          ? JSON.stringify({ results: [] })
          : JSON.stringify({ holder: { name: 'Jon Hale', isCurrent: true, sourceIds: [4, 5] } }),
    };
    const result = await run(provider([], {}, twoNames), llm);
    expect(result.trace.extraction).toBe('disagree');
    expect(result.verifiedHolder).toBeNull();
  });

  it('gives Claude only results about this company, without job ads', async () => {
    const prompts: string[] = [];
    const llm: LlmClient = {
      complete: async ({ prompt }) => {
        prompts.push(prompt);
        return prompt.includes('<candidates>') ? JSON.stringify({ results: [] }) : JSON.stringify({ holder: null });
      },
    };
    const noisy: SearchHit[] = [
      ...evidence,
      { title: 'Executive Assistant to the CEO', snippet: 'Orbitly is hiring.', url: 'https://www.orbitly.com/careers/job/9' },
      { title: 'CEO Mara Velin on growth', snippet: 'Mara Velin, CEO of Quillstone.', url: 'https://talks.example/2' },
    ];
    await run(provider([], {}, noisy), llm);
    const extraction = prompts.find((p) => p.includes('Results:')) ?? '';
    expect(extraction).toMatch(/ir\.orbitly\.com/);
    expect(extraction).not.toMatch(/careers/);
    expect(extraction).not.toMatch(/Quillstone/);
  });

  // Production 2026-10-27 (tesla.com + Electrical Engineer / Engineer): job ads and an old press
  // release produced a "verified" holder for a role thousands of people hold.
  it('does not look for a single verified holder when many people hold the role', async () => {
    const seen: string[] = [];
    const result = await runSearchPipeline(
      { domain: 'orbitly.com', position: 'Electrical Engineer' },
      {
        searchProvider: provider(seen, {}),
        fetchHomepage: async () => '<title>Orbitly</title>',
        llm: null,
        corroborate: true,
      },
    );
    expect(seen.some((q) => q.includes('-site:linkedin.com'))).toBe(false);
    expect(result.verifiedHolder).toBeNull();
    expect(result.trace.decision).not.toBe('verified_profile');
  });

  it('records every query with its kind, hit count and time', async () => {
    const result = await run(provider([], { '"Andrew Corwin"': [andrew], '"Andy Corwin"': [] }));
    const kinds = new Set(result.trace.queries.map((q) => q.kind));
    expect(kinds).toEqual(new Set(['linkedin', 'evidence', 'person']));
    expect(result.trace.queries.every((q) => q.hits >= 0 && q.ms >= 0)).toBe(true);
    expect(result.trace.evidence[0]).toMatchObject({ name: 'Andy Corwin', hosts: ['ir.orbitly.com', 'answers.example'] });
    expect(JSON.stringify(result.trace)).not.toMatch(/President and Chief Executive Officer\./); // no snippets
  });
});

describe('runSearchPipeline: defaults', () => {
  it('allows about 18 s for the whole search', () => {
    expect(DEFAULT_TIMING.totalMs).toBeGreaterThanOrEqual(18_000);
    expect(DEFAULT_TIMING.totalMs).toBeLessThanOrEqual(20_000);
  });

  it('keeps the demo path unchanged: no verification fields, decision "not_checked"', async () => {
    const result = await runSearchPipeline({ domain: 'nimbus-labs.example', position: 'CTO' }, fastMocks());
    expect(result.verifiedHolder).toBeUndefined();
    expect(result.results.every((r) => r.verified === undefined)).toBe(true);
    expect(result.trace.decision).toBe('not_checked');
  });
});

describe('filterAndDedupe', () => {
  it('drops hidden or anonymous profiles ("LinkedIn Member") that cannot be checked by name', async () => {
    const { filterAndDedupe } = await import('../shared/pipeline');
    const out = filterAndDedupe([
      { title: 'LinkedIn Member - CEO - Orbitly | LinkedIn', snippet: 'CEO at Orbitly', url: 'https://www.linkedin.com/in/abc123' },
      { title: 'Andy Corwin - Orbitly | LinkedIn', snippet: 'CEO at Orbitly', url: 'https://de.linkedin.com/in/andycorwin/en' },
    ]);
    expect(out.map((c) => c.linkedinUrl)).toEqual(['https://www.linkedin.com/in/andycorwin']);
  });
});

// Production 2026-10-28 (bugatti.com + Mechanical Engineer): 10 profiles came back and all were
// hidden; nothing broader was tried. Fictional company and people, same shapes.
describe('runSearchPipeline: roles many people hold (real app)', () => {
  const html = `<html lang="fr"><head><title>Northwind | Official Site</title>
    <script type="application/ld+json">{"@type":"Organization","name":"Northwind Automobiles"}</script></head></html>`;
  const profile = (i: number, headline: string, host = 'www', snippet = 'Zagreb') => ({
    title: `Person ${i} - ${headline} | LinkedIn`,
    snippet,
    url: `https://${host}.linkedin.com/in/person-${i}`,
  });

  it('keeps ordinary short profiles, widens the search with variants, translations and the company’s other names, and returns up to 25', async () => {
    const seen: string[] = [];
    const prompts: string[] = [];
    const provider: SearchProvider = {
      name: 'test',
      search: async (query, { limit, onUsage }) => {
        seen.push(query);
        onUsage?.(limit > 10 ? 2 : 1);
        if (query.includes('Ingénieur mécanique'))
          return [1, 2, 3, 4].map((i) => profile(100 + i, 'Ingénieur mécanique - Northwind', 'fr'));
        if (query.includes('"Northwind Automobiles"'))
          return [1, 2].map((i) => profile(200 + i, 'Mechanical Engineer at Northwind Automobiles'));
        if (query.includes('"Mechanical Engineering"'))
          return [1, 2, 3].map((i) => profile(300 + i, 'Mechanical Engineering @ Northwind Rimo', 'hr'));
        if (query.includes('"Northwind" "Mechanical Engineer"'))
          return [1, 2, 3].map((i) => profile(i, 'Mechanical Engineer at Northwind Rimo', 'hr'));
        return [];
      },
    };
    const llm: LlmClient = {
      complete: async ({ prompt, system }) => {
        prompts.push(prompt);
        if (system.includes('ways people write one job title')) return JSON.stringify({ variants: ['Ingénieur mécanique'] });
        // Rank everyone it was shown, by id.
        const ids = [...prompt.matchAll(/"id": (\d+)/g)].map((m) => Number(m[1]));
        return JSON.stringify({ results: ids.map((id) => ({ id, confidence: 75, reason: 'Role at the company.' })) });
      },
    };
    const result = await runSearchPipeline(
      { domain: 'northwind.com', position: 'Mechanical Engineer' },
      { searchProvider: provider, fetchHomepage: async () => html, llm, corroborate: true },
    );
    expect(seen.some((q) => q.includes('Ingénieur mécanique'))).toBe(true);
    expect(seen.some((q) => q.includes('"Northwind Automobiles"'))).toBe(true);
    expect(seen.some((q) => q.includes('"Mechanical Engineering"'))).toBe(true);
    expect(prompts.some((p) => /French|Croatian/.test(p))).toBe(true);
    expect(result.trace.decision).toBe('unverified');
    expect(result.results.length).toBeGreaterThanOrEqual(10);
    expect(result.results.length).toBeLessThanOrEqual(25);
    expect(result.trace.funnel?.credits).toBeLessThanOrEqual(14);
    expect(result.trace.funnel?.tiers).toBeGreaterThanOrEqual(2);
  });

  it('stops after the first round when it already has enough credible people (no extra cost)', async () => {
    const seen: string[] = [];
    const provider: SearchProvider = {
      name: 'test',
      search: async (query) => {
        seen.push(query);
        return Array.from({ length: 12 }, (_, i) =>
          profile(i, 'Mechanical Engineer at Northwind', 'www', 'Experience: Northwind · Location: Paris'),
        );
      },
    };
    const result = await runSearchPipeline(
      { domain: 'northwind.com', position: 'Mechanical Engineer' },
      { searchProvider: provider, fetchHomepage: async () => html, llm: null, corroborate: true },
    );
    expect(seen).toHaveLength(2);
    expect(result.results.length).toBeGreaterThanOrEqual(10);
    expect(result.trace.funnel?.tiers).toBe(1);
  });

  it('shows clearly labelled closest matches instead of nothing', async () => {
    const provider: SearchProvider = {
      name: 'test',
      search: async (query) =>
        query.includes('"Northwind" "Mechanical Engineer"')
          ? [profile(1, 'Powertrain Engineer at Northwind', 'www', 'Experience: Northwind')]
          : [],
    };
    const result = await runSearchPipeline(
      { domain: 'northwind.com', position: 'Mechanical Engineer' },
      { searchProvider: provider, fetchHomepage: async () => html, llm: null, corroborate: true },
    );
    expect(result.trace.decision).toBe('closest');
    expect(result.results[0]?.reasoning).toMatch(/Closest match/);
    expect(result.triedTitles?.length).toBeGreaterThan(0);
  });
});

describe('runSearchPipeline: accuracy fixes (real app)', () => {
  const run = (provider: SearchProvider, position: string, llm: LlmClient | null = null) =>
    runSearchPipeline(
      { domain: 'orbitly.com', position },
      { searchProvider: provider, fetchHomepage: async () => '<title>Orbitly</title>', llm, corroborate: true },
    );

  // figma.com + Head of Design (2026-10-28): the top design leader is the Chief Design Officer.
  it('when nobody is named for "Head of X", finds the top role of that function and labels it', async () => {
    const provider: SearchProvider = {
      name: 'test',
      search: async (query) => {
        if (query.includes('"Chief Design Officer" -site:linkedin.com'))
          return [
            { title: 'Orbitly names Mara Velin Chief Design Officer', snippet: '', url: 'https://news.example/1' },
            { title: 'Mara Velin, Chief Design Officer at Orbitly', snippet: '', url: 'https://talks.example/2' },
          ];
        if (query.includes('"Mara Velin" "Orbitly"'))
          return [
            {
              title: 'Mara Velin - Chief Design Officer at Orbitly | LinkedIn',
              snippet: 'Experience: Orbitly',
              url: 'https://www.linkedin.com/in/maravelin',
            },
          ];
        return [];
      },
    };
    const result = await run(provider, 'Head of Design');
    expect(result.verifiedHolder).toMatchObject({ name: 'Mara Velin', role: 'Chief Design Officer' });
    expect(result.trace.decision).toBe('verified_profile');
  });

  // absurdventures.com + CEO (2026-10-28): one encyclopedia named the CEO.
  it('shows a holder named by one strong source as "likely"', async () => {
    const provider: SearchProvider = {
      name: 'test',
      search: async (query) =>
        query.includes('-site:linkedin.com')
          ? [{ title: 'Orbitly - Wikipedia', snippet: 'Orbitly is led by CEO Jon Hale.', url: 'https://en.wikipedia.org/wiki/Orbitly' }]
          : [],
    };
    const result = await run(provider, 'CEO');
    expect(result.trace.decision).toBe('likely');
    expect(result.verifiedHolder?.name).toBe('Jon Hale');
    expect(result.results.every((r) => !r.verified)).toBe(true);
  });

  // cloudflare.com + CTO (2026-10-28): the only profile with his exact name didn't mention the company.
  it('attaches the only exact-name profile of a verified person, labelled as a name-only match', async () => {
    const evidence: SearchHit[] = [
      { title: 'Orbitly CTO Ian Brask', snippet: '', url: 'https://news.example/1' },
      { title: 'Ian Brask, CTO at Orbitly', snippet: '', url: 'https://talks.example/2' },
    ];
    const provider: SearchProvider = {
      name: 'test',
      search: async (query) => {
        if (query.includes('-site:linkedin.com')) return evidence;
        if (query === 'site:linkedin.com/in "Ian Brask"')
          return [{ title: 'Ian Brask | LinkedIn', snippet: 'Austin, Texas', url: 'https://www.linkedin.com/in/ianbrask' }];
        return [];
      },
    };
    const result = await run(provider, 'CTO');
    expect(result.trace.decision).toBe('verified_name_match');
    expect(result.results[0]?.linkedinUrl).toBe('https://www.linkedin.com/in/ianbrask');
    expect(result.results[0]?.verified).toBe(false);
  });

  // personio.com (2026-10-28): a person lookup timed out.
  it('retries a person lookup that failed once', async () => {
    let calls = 0;
    const provider: SearchProvider = {
      name: 'test',
      search: async (query) => {
        if (query.includes('-site:linkedin.com'))
          return [
            { title: 'Orbitly CTO Ian Brask', snippet: '', url: 'https://news.example/1' },
            { title: 'Ian Brask, CTO at Orbitly', snippet: '', url: 'https://talks.example/2' },
          ];
        if (query === 'site:linkedin.com/in "Ian Brask" "Orbitly"') {
          calls++;
          if (calls === 1) throw new Error('timed out');
          return [
            { title: 'Ian Brask - CTO at Orbitly | LinkedIn', snippet: 'Experience: Orbitly', url: 'https://www.linkedin.com/in/ianbrask' },
          ];
        }
        return [];
      },
    };
    const result = await run(provider, 'CTO');
    expect(calls).toBe(2);
    expect(result.trace.decision).toBe('verified_profile');
  });
});
