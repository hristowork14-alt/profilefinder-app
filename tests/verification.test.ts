import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../shared/memoryStore';
import { performSearch, type SearchServiceDeps } from '../shared/searchService';
import type { SearchHit, SearchProvider, SearchResponse } from '../shared/types';

// Service level: the verified holder reaches the response, history, diagnostics and cache.
const USER = '11111111-1111-4111-8111-111111111111';
const evidence: SearchHit[] = [
  { title: 'Leadership | Orbitly', snippet: 'Elle Marsk, Chief Executive Officer.', url: 'https://www.orbitly.com/leadership' },
  { title: 'Who is the CEO of Orbitly?', snippet: 'Elle Marsk has been CEO of Orbitly since 2008.', url: 'https://answers.example/b' },
];
const fake: SearchHit = {
  title: 'zed fakeman - Chief Executive Officer at Orbitly | LinkedIn',
  snippet: 'Chief Executive Officer at Orbitly · 0 followers',
  url: 'https://www.linkedin.com/in/zed-fakeman-a13481385',
};

function setup() {
  let serperCalls = 0;
  const provider: SearchProvider = {
    name: 'test',
    search: async (query) => {
      serperCalls++;
      return query.includes('-site:linkedin.com') ? evidence : [fake];
    },
  };
  const store = createMemoryStore();
  const logs: string[] = [];
  const deps: SearchServiceDeps = {
    store,
    pipelineDeps: { searchProvider: provider, fetchHomepage: async () => '<title>Orbitly</title>', llm: null, corroborate: true },
    config: { maxSearchesPerHour: 30, cacheTtlMs: 7 * 24 * 3600 * 1000 },
    log: (m) => logs.push(m),
  };
  return { store, deps, logs, calls: () => serperCalls };
}

describe('performSearch with verification', () => {
  it('returns the verified holder (no profiles) when the real person has no findable profile', async () => {
    const { deps } = setup();
    const outcome = await performSearch(USER, { companyUrl: 'orbitly.com', position: 'CEO' }, deps);
    expect(outcome.status).toBe(200);
    const body = outcome.body as SearchResponse;
    expect(body.results).toEqual([]);
    expect(body.verifiedHolder).toMatchObject({ name: 'Elle Marsk' });
    expect(body.message).toBeNull();
  });

  it('saves the holder and the diagnostics with the search', async () => {
    const { deps, store } = setup();
    await performSearch(USER, { companyUrl: 'orbitly.com', position: 'CEO' }, deps);
    const saved = store.searches[0];
    expect(saved?.verifiedHolder?.name).toBe('Elle Marsk');
    expect(saved?.status).toBe('completed');
    const trace = store.diagnostics.get(saved!.id);
    expect(trace?.decision).toBe('verified_no_profile');
    expect(trace?.queries.length).toBeGreaterThan(0);
  });

  it('caches a verified-holder answer and serves it, holder included, without new search calls', async () => {
    const { deps, calls } = setup();
    await performSearch(USER, { companyUrl: 'orbitly.com', position: 'CEO' }, deps);
    const before = calls();
    const again = await performSearch(USER, { companyUrl: 'orbitly.com', position: 'CEO' }, deps);
    const body = again.body as SearchResponse;
    expect(body.fromCache).toBe(true);
    expect(body.verifiedHolder?.name).toBe('Elle Marsk');
    expect(calls()).toBe(before);
  });

  it('logs one summary line per search without personal data', async () => {
    const { deps, logs } = setup();
    await performSearch(USER, { companyUrl: 'orbitly.com', position: 'CEO' }, deps);
    const summary = logs.find((l) => l.startsWith('search '));
    expect(summary).toMatch(/orbitly\.com/);
    expect(summary).toMatch(/verified_no_profile/);
    expect(summary).toMatch(/\d+ ms/);
    expect(summary).not.toMatch(/Elle Marsk/);
  });
});
