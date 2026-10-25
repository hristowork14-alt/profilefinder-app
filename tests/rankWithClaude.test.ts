import { describe, expect, it } from 'vitest';
import { parseRankingResponse } from '../shared/rankingSchema';
import { RankingError, buildRankingPrompt, rankWithClaude } from '../shared/rankWithClaude';
import type { Candidate, LlmClient, RankingContext } from '../shared/types';

const ctx: RankingContext = { companyName: 'Stripe', domain: 'stripe.com', position: 'CFO', synonyms: ['Chief Financial Officer'] };
const candidates: Candidate[] = [
  {
    slug: 'jane-doe',
    title: 'Jane Doe - CFO - Stripe | LinkedIn',
    snippet: 'CFO at Stripe',
    linkedinUrl: 'https://www.linkedin.com/in/jane-doe',
  },
  { slug: 'bob-roe', title: 'Bob Roe - VP Finance - Stripe | LinkedIn', snippet: '', linkedinUrl: 'https://www.linkedin.com/in/bob-roe' },
];

const valid = JSON.stringify({
  results: [
    {
      fullName: 'Bob Roe',
      headline: 'VP Finance - Stripe',
      linkedinUrl: 'https://www.linkedin.com/in/bob-roe',
      confidence: 60,
      reasoning: 'Finance leader at Stripe.',
    },
    {
      fullName: 'Jane Doe',
      headline: 'CFO - Stripe',
      linkedinUrl: 'https://www.linkedin.com/in/jane-doe',
      confidence: 92,
      reasoning: 'Current CFO at Stripe.',
    },
  ],
});

describe('parseRankingResponse (zod validation)', () => {
  it('accepts valid JSON and sorts by confidence', () => {
    const parsed = parseRankingResponse(valid, candidates);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.results.map((r) => r.fullName)).toEqual(['Jane Doe', 'Bob Roe']);
  });

  it('accepts JSON wrapped in a code fence or surrounded by text', () => {
    expect(parseRankingResponse('```json\n' + valid + '\n```', candidates).ok).toBe(true);
    expect(parseRankingResponse('Here you go:\n' + valid, candidates).ok).toBe(true);
  });

  it('accepts an empty list', () => {
    const parsed = parseRankingResponse('{"results": []}', candidates);
    expect(parsed).toEqual({ ok: true, results: [] });
  });

  it('rejects malformed JSON and schema violations', () => {
    expect(parseRankingResponse('not json', candidates).ok).toBe(false);
    expect(parseRankingResponse('{"results": [{"fullName": "X"}]}', candidates).ok).toBe(false);
    expect(
      parseRankingResponse(
        JSON.stringify({
          results: [{ fullName: 'X', headline: '', linkedinUrl: 'https://www.linkedin.com/in/jane-doe', confidence: 150, reasoning: 'x' }],
        }),
        candidates,
      ).ok,
    ).toBe(false);
    expect(parseRankingResponse('{"people": []}', candidates).ok).toBe(false);
  });

  it('drops URLs that were not in the candidate list (no invented URLs)', () => {
    const invented = JSON.stringify({
      results: [
        {
          fullName: 'Ghost',
          headline: 'CFO',
          linkedinUrl: 'https://www.linkedin.com/in/made-up-person',
          confidence: 99,
          reasoning: 'Invented.',
        },
        {
          fullName: 'Jane Doe',
          headline: 'CFO - Stripe',
          linkedinUrl: 'https://uk.linkedin.com/in/Jane-Doe/?trk=x',
          confidence: 90,
          reasoning: 'Current CFO.',
        },
      ],
    });
    const parsed = parseRankingResponse(invented, candidates);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0]?.linkedinUrl).toBe('https://www.linkedin.com/in/jane-doe');
    }
  });

  it('removes duplicates and caps at 5 results', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      fullName: `P${i}`,
      headline: '',
      linkedinUrl: 'https://www.linkedin.com/in/jane-doe',
      confidence: 50 + i,
      reasoning: 'x',
    }));
    const parsed = parseRankingResponse(JSON.stringify({ results: many.slice(0, 5) }), candidates);
    expect(parsed.ok && parsed.results.length).toBe(1);
    expect(parseRankingResponse(JSON.stringify({ results: many }), candidates).ok).toBe(false);
  });
});

describe('rankWithClaude', () => {
  const clientReturning = (...responses: string[]): LlmClient & { calls: number } => {
    const client = {
      calls: 0,
      async complete() {
        const response = responses[Math.min(client.calls, responses.length - 1)] ?? '';
        client.calls++;
        return response;
      },
    };
    return client;
  };

  it('builds a prompt that lists the candidates and the rules', () => {
    const { system, prompt } = buildRankingPrompt(candidates, ctx);
    expect(system).toMatch(/only.*URLs.*provided/i);
    expect(system).toMatch(/former/i);
    expect(prompt).toContain('https://www.linkedin.com/in/jane-doe');
    expect(prompt).toContain('stripe.com');
  });

  it('returns validated results on the first try', async () => {
    const client = clientReturning(valid);
    const results = await rankWithClaude(candidates, ctx, client, { timeoutMs: 1000, allowRetry: true });
    expect(results[0]?.fullName).toBe('Jane Doe');
    expect(client.calls).toBe(1);
  });

  it('retries once on invalid JSON', async () => {
    const client = clientReturning('oops', valid);
    const results = await rankWithClaude(candidates, ctx, client, { timeoutMs: 1000, allowRetry: true });
    expect(results).toHaveLength(2);
    expect(client.calls).toBe(2);
  });

  it('throws RankingError after the retry also fails', async () => {
    const client = clientReturning('oops', 'still oops');
    await expect(rankWithClaude(candidates, ctx, client, { timeoutMs: 1000, allowRetry: true })).rejects.toBeInstanceOf(RankingError);
    expect(client.calls).toBe(2);
  });

  it('does not retry when the time budget forbids it', async () => {
    const client = clientReturning('oops', valid);
    await expect(rankWithClaude(candidates, ctx, client, { timeoutMs: 1000, allowRetry: false })).rejects.toBeInstanceOf(RankingError);
    expect(client.calls).toBe(1);
  });
});
