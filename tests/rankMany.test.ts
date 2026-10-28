import { describe, expect, it } from 'vitest';
import { buildManyRankingPrompt, parseManyRanking, rankManyWithClaude } from '../shared/rankMany';
import type { Candidate, LlmClient, RankingContext } from '../shared/types';

const ctx: RankingContext = {
  companyName: 'Northwind',
  domain: 'northwind.com',
  position: 'Mechanical Engineer',
  synonyms: [],
  manyHolders: true,
  aliases: ['Northwind Rimo'],
  variants: ['Mechanical Design Engineer', 'Ingénieur mécanique'],
};

const candidate = (slug: string, title: string, snippet = ''): Candidate => ({
  title,
  snippet,
  slug,
  linkedinUrl: `https://www.linkedin.com/in/${slug}`,
});

const candidates: Candidate[] = [
  candidate('ana-kos', 'Ana Kos - Mechanical Engineer at Northwind Rimo | LinkedIn', 'Zagreb'),
  candidate('ivo-bar', 'Ivo Bar - Ingénieur mécanique - Northwind | LinkedIn', 'Molsheim'),
  candidate('jo-lee', 'Jo Lee - ex-Northwind Mechanical Engineer | LinkedIn', 'Now at Quillstone'),
];

describe('buildManyRankingPrompt', () => {
  it('tells Claude that many people hold the role, lists the company names and title variants, and numbers the candidates', () => {
    const { system, prompt } = buildManyRankingPrompt(candidates, ctx);
    expect(system).toMatch(/many people/i);
    expect(system).toMatch(/former/i);
    expect(prompt).toMatch(/Northwind Rimo/);
    expect(prompt).toMatch(/Ingénieur mécanique/);
    expect(prompt).toMatch(/"id": 1/);
    // The model refers to candidates by number; URLs are never needed in its reply.
    expect(system).not.toMatch(/linkedinUrl/);
  });
});

describe('parseManyRanking', () => {
  it('maps ids back to the candidates (no URL can be invented) and sorts by confidence', () => {
    const text = JSON.stringify({
      results: [
        { id: 2, confidence: 70, reason: 'French title for the role at Northwind.' },
        { id: 1, confidence: 88, reason: 'Role at Northwind Rimo, the same group.' },
        { id: 9, confidence: 99, reason: 'invented' },
        { id: 1, confidence: 10, reason: 'duplicate' },
      ],
    });
    const out = parseManyRanking(text, candidates, 25);
    expect(out.ok && out.results.map((r) => [r.fullName, r.confidence, r.linkedinUrl])).toEqual([
      ['Ana Kos', 88, 'https://www.linkedin.com/in/ana-kos'],
      ['Ivo Bar', 70, 'https://www.linkedin.com/in/ivo-bar'],
    ]);
  });

  it('caps the number of results and rejects malformed replies', () => {
    const many = JSON.stringify({ results: candidates.map((_, i) => ({ id: i + 1, confidence: 60, reason: 'r' })) });
    const capped = parseManyRanking(many, candidates, 2);
    expect(capped.ok && capped.results).toHaveLength(2);
    expect(parseManyRanking('nope', candidates, 25).ok).toBe(false);
  });
});

describe('rankManyWithClaude', () => {
  it('returns ranked profiles from one model call', async () => {
    const llm: LlmClient = {
      complete: async () => JSON.stringify({ results: [{ id: 1, confidence: 80, reason: 'Role at the company.' }] }),
    };
    const out = await rankManyWithClaude(candidates, ctx, llm, { timeoutMs: 1000, maxResults: 25 });
    expect(out.map((r) => r.fullName)).toEqual(['Ana Kos']);
    expect(out[0]?.headline).toBe('Mechanical Engineer at Northwind Rimo');
  });

  it('throws when the reply cannot be used, so the caller can fall back to the heuristic', async () => {
    const llm: LlmClient = { complete: async () => 'not json' };
    await expect(rankManyWithClaude(candidates, ctx, llm, { timeoutMs: 1000, maxResults: 25 })).rejects.toThrow();
  });
});
