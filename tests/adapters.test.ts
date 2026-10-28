import { describe, expect, it } from 'vitest';
import { createHomepageFetcher } from '../netlify/functions/_lib/companyResolver';
import { ConfigError, DEFAULT_ANTHROPIC_MODEL, readEnv } from '../netlify/functions/_lib/env';
import { bearerToken } from '../netlify/functions/_lib/http';
import { createSearchProvider } from '../netlify/functions/_lib/searchProvider';
import { SearchProviderError, createSerperProvider } from '../netlify/functions/_lib/serper';

const signal = () => new AbortController().signal;

describe('Serper adapter', () => {
  it('sends the query with the API key and maps organic results', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), init: init ?? {} };
      return new Response(
        JSON.stringify({
          organic: [
            { title: 'Jane Doe - CFO - Stripe | LinkedIn', link: 'https://www.linkedin.com/in/jane-doe', snippet: 'CFO at Stripe' },
            { title: 'No link' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const hits = await createSerperProvider('secret-key', fakeFetch).search('site:linkedin.com/in "Stripe" "CFO"', {
      signal: signal(),
      limit: 10,
    });
    expect(hits).toEqual([
      { title: 'Jane Doe - CFO - Stripe | LinkedIn', snippet: 'CFO at Stripe', url: 'https://www.linkedin.com/in/jane-doe' },
    ]);
    expect(seen!.url).toBe('https://google.serper.dev/search');
    expect((seen!.init.headers as Record<string, string>)['X-API-KEY']).toBe('secret-key');
    expect(JSON.parse(String(seen!.init.body))).toEqual({ q: 'site:linkedin.com/in "Stripe" "CFO"', num: 10 });
  });

  it('reports the credits Serper charged, and assumes 1 (2 above 10 results) when it does not say', async () => {
    const reply = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
    const used: number[] = [];
    const onUsage = (credits: number) => used.push(credits);
    await createSerperProvider('k', reply({ organic: [], credits: 2 })).search('q', { signal: signal(), limit: 10, onUsage });
    await createSerperProvider('k', reply({ organic: [] })).search('q', { signal: signal(), limit: 10, onUsage });
    await createSerperProvider('k', reply({ organic: [] })).search('q', { signal: signal(), limit: 50, onUsage });
    expect(used).toEqual([2, 1, 2]);
  });

  it('asks for up to 100 results when more are needed', async () => {
    let body: unknown = null;
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ organic: [] }), { status: 200 });
    }) as typeof fetch;
    await createSerperProvider('k', fakeFetch).search('q', { signal: signal(), limit: 500 });
    expect(body).toEqual({ q: 'q', num: 100 });
  });

  it('also returns the answer box, knowledge graph and "People also ask" as extra hits after the organic ones', async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          answerBox: {
            title: 'Northwind / CTO',
            answer: 'Mara Velin',
            snippet: 'Mara Velin is the CTO of Northwind.',
            link: 'https://a.example',
          },
          knowledgeGraph: { title: 'Northwind', description: 'Cloud company.', attributes: { CTO: 'Mara Velin', Founded: '2009' } },
          peopleAlsoAsk: [
            { question: 'Who is the CTO of Northwind?', snippet: 'Mara Velin has been CTO since 2025.', link: 'https://b.example' },
          ],
          organic: [
            { title: 'One', link: 'https://one.example', snippet: 's1' },
            { title: 'Two', link: 'https://two.example', snippet: 's2' },
            { title: 'Three', link: 'https://three.example', snippet: 's3' },
          ],
        }),
        { status: 200 },
      )) as typeof fetch;

    const hits = await createSerperProvider('k', fakeFetch).search('"Northwind" "CTO" -site:linkedin.com', { signal: signal(), limit: 2 });
    // The organic limit is respected; extras come after and never displace organic results.
    expect(hits.map((h) => h.url)).toEqual([
      'https://one.example',
      'https://two.example',
      'https://a.example',
      'https://serper.dev/knowledge-graph',
      'https://b.example',
    ]);
    expect(hits[2]).toEqual({
      title: 'Northwind / CTO',
      snippet: 'Mara Velin — Mara Velin is the CTO of Northwind.',
      url: 'https://a.example',
    });
    expect(hits[3]?.snippet).toBe('Cloud company. CTO: Mara Velin. Founded: 2009');
    expect(hits[4]).toEqual({
      title: 'Who is the CTO of Northwind?',
      snippet: 'Mara Velin has been CTO since 2025.',
      url: 'https://b.example',
    });
  });

  it('throws a SearchProviderError on HTTP errors', async () => {
    const fakeFetch = (async () => new Response('nope', { status: 403 })) as typeof fetch;
    await expect(createSerperProvider('bad', fakeFetch).search('q', { signal: signal(), limit: 10 })).rejects.toBeInstanceOf(
      SearchProviderError,
    );
  });
});

describe('homepage fetcher', () => {
  const html = (body: string) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

  it('follows safe redirects and returns HTML', async () => {
    const visited: string[] = [];
    const fakeFetch = (async (url: string | URL | Request) => {
      visited.push(String(url));
      if (String(url) === 'https://acme.io/') return new Response(null, { status: 301, headers: { Location: 'https://www.acme.io/en' } });
      return html('<title>Acme | Home</title>');
    }) as typeof fetch;
    expect(await createHomepageFetcher(fakeFetch)('acme.io', signal())).toContain('Acme');
    expect(visited).toEqual(['https://acme.io/', 'https://www.acme.io/en']);
  });

  it('never fetches linkedin.com, even through a redirect', async () => {
    const visited: string[] = [];
    const fakeFetch = (async (url: string | URL | Request) => {
      visited.push(String(url));
      return new Response(null, { status: 302, headers: { Location: 'https://www.linkedin.com/company/acme' } });
    }) as typeof fetch;
    await expect(createHomepageFetcher(fakeFetch)('acme.io', signal())).rejects.toThrow(/linkedin/i);
    expect(visited).toEqual(['https://acme.io/']);
    await expect(createHomepageFetcher(fakeFetch)('linkedin.com', signal())).rejects.toThrow(/linkedin/i);
    expect(visited).toHaveLength(1);
  });

  it('refuses redirects to IP addresses and non-HTML responses', async () => {
    const toIp = (async () => new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest' } })) as typeof fetch;
    await expect(createHomepageFetcher(toIp)('acme.io', signal())).rejects.toThrow();
    const pdf = (async () => new Response('%PDF', { status: 200, headers: { 'Content-Type': 'application/pdf' } })) as typeof fetch;
    await expect(createHomepageFetcher(pdf)('acme.io', signal())).rejects.toThrow(/HTML/);
  });

  it('caps the amount of HTML read', async () => {
    const big = (async () => html('<title>Acme</title>' + 'x'.repeat(2_000_000))) as typeof fetch;
    const text = await createHomepageFetcher(big)('acme.io', signal());
    expect(text.length).toBeLessThanOrEqual(512 * 1024);
  });
});

describe('configuration', () => {
  it('reads defaults', () => {
    const env = readEnv({});
    expect(env.searchProvider).toBe('serper');
    expect(env.anthropicModel).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(env.maxSearchesPerHour).toBe(30);
    expect(env.useMocks).toBe(false);
    expect(readEnv({ MAX_SEARCHES_PER_HOUR: '5', USE_MOCKS: 'true' })).toMatchObject({ maxSearchesPerHour: 5, useMocks: true });
    expect(readEnv({ MAX_SEARCHES_PER_HOUR: 'abc' }).maxSearchesPerHour).toBe(30);
  });

  it('USE_MOCKS swaps in the fixture provider behind the same interface', () => {
    expect(createSearchProvider(readEnv({ USE_MOCKS: 'true' })).name).toBe('mock');
    expect(createSearchProvider(readEnv({ SERPER_API_KEY: 'k' })).name).toBe('serper');
  });

  it('explains missing or unknown provider configuration', () => {
    expect(() => createSearchProvider(readEnv({}))).toThrow(ConfigError);
    expect(() => createSearchProvider(readEnv({ SEARCH_PROVIDER: 'bing', SERPER_API_KEY: 'k' }))).toThrow(/Unknown SEARCH_PROVIDER/);
  });

  it('extracts bearer tokens strictly', () => {
    const req = (value?: string) => new Request('http://x', { headers: value ? { Authorization: value } : {} });
    expect(bearerToken(req('Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature'))).toBe('eyJhbGciOiJIUzI1NiJ9.payload.signature');
    expect(bearerToken(req())).toBeNull();
    expect(bearerToken(req('Basic abc'))).toBeNull();
    expect(bearerToken(req('Bearer short'))).toBeNull();
  });
});
