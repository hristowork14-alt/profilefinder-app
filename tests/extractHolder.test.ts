import { describe, expect, it } from 'vitest';
import { buildExtractionPrompt, extractHolderWithClaude, parseExtraction } from '../shared/extractHolder';
import type { LlmClient, RankingContext, SearchHit } from '../shared/types';

// Fictional people in real evidence formats (dossier, company leadership page, news).
const ctx: RankingContext = { companyName: 'Orbitly', domain: 'orbitly.com', position: 'CEO', synonyms: ['Chief Executive Officer'] };
const evidence: SearchHit[] = [
  {
    title: 'Leadership | Orbitly',
    snippet: 'Andy Corwin, President and Chief Executive Officer.',
    url: 'https://ir.orbitly.com/leadership',
  },
  {
    title: 'Orbitly founder Jeff Hale steps down as CEO',
    snippet: 'Jeff Hale handed the CEO role to Andy Corwin in 2021.',
    url: 'https://news.example/a',
  },
  {
    title: 'Who is the CEO of Orbitly?',
    snippet: 'Andy Corwin has been CEO of Orbitly since July 2021.',
    url: 'https://answers.example/b',
  },
];

const reply = (body: unknown): LlmClient => ({ complete: async () => JSON.stringify(body) });

describe('buildExtractionPrompt', () => {
  it('numbers the evidence, names the hosts and asks for the current holder only', () => {
    const { system, prompt } = buildExtractionPrompt(evidence, ctx);
    expect(prompt).toMatch(/\[1\] ir\.orbitly\.com/);
    expect(prompt).toMatch(/\[3\] answers\.example/);
    expect(prompt).toMatch(/Position: CEO/);
    expect(system).toMatch(/currently/i);
    expect(system).toMatch(/former/i);
    expect(system).toMatch(/another (?:company|organisation)/i);
  });
});

describe('parseExtraction', () => {
  it('accepts a current holder whose name appears in the cited sources, weighting the official domain double', () => {
    const parsed = parseExtraction(JSON.stringify({ holder: { name: 'Andy Corwin', isCurrent: true, sourceIds: [1, 3] } }), evidence, ctx);
    expect(parsed).toEqual({
      name: 'Andy Corwin',
      sources: 3,
      sites: 2,
      strongSites: 2,
      links: [
        {
          title: 'Leadership | Orbitly',
          url: 'https://ir.orbitly.com/leadership',
          quote: 'Andy Corwin, President and Chief Executive Officer.',
        },
        {
          title: 'Who is the CEO of Orbitly?',
          url: 'https://answers.example/b',
          quote: 'Andy Corwin has been CEO of Orbitly since July 2021.',
        },
      ],
    });
  });

  it('does not count cited results that give the person the role at another company', () => {
    const elsewhere: SearchHit[] = [
      {
        title: 'Andy Corwin (CEO at Quillstone)',
        snippet: 'Andy Corwin, formerly at Orbitly, now runs Quillstone.',
        url: 'https://pod.example/1',
      },
      {
        title: 'Who is the CEO of Orbitly?',
        snippet: 'Andy Corwin has been CEO of Orbitly since July 2021.',
        url: 'https://answers.example/b',
      },
    ];
    const parsed = parseExtraction(JSON.stringify({ holder: { name: 'Andy Corwin', isCurrent: true, sourceIds: [1, 2] } }), elsewhere, ctx);
    expect(parsed).toMatchObject({ sources: 1, sites: 1 });
    expect(parsed?.links.map((l) => l.url)).toEqual(['https://answers.example/b']);
  });

  it('marks support that rests only on weak sites (video, social) as having no strong site', () => {
    const weak: SearchHit[] = [
      { title: 'Orbitly CEO Andy Corwin keynote', snippet: '', url: 'https://www.youtube.com/watch?v=1' },
      { title: 'Orbitly CEO Andy Corwin AMA', snippet: '', url: 'https://www.reddit.com/r/x/comments/1/' },
    ];
    const parsed = parseExtraction(JSON.stringify({ holder: { name: 'Andy Corwin', isCurrent: true, sourceIds: [1, 2] } }), weak, ctx);
    expect(parsed).toMatchObject({ strongSites: 0 });
  });

  it('ignores cited job ads and pages that never mention the company', () => {
    const noisy: SearchHit[] = [
      { title: 'CEO Andy Corwin on leadership', snippet: 'Andy Corwin, CEO, explains.', url: 'https://talks.example/1' },
      {
        title: 'Executive Assistant to the CEO',
        snippet: 'Orbitly CEO Andy Corwin is hiring.',
        url: 'https://www.orbitly.com/careers/job/1',
      },
    ];
    expect(parseExtraction(JSON.stringify({ holder: { name: 'Andy Corwin', isCurrent: true, sourceIds: [1, 2] } }), noisy, ctx)).toBeNull();
  });

  it('rejects names that are not literally in the cited sources (no invented people)', () => {
    expect(
      parseExtraction(JSON.stringify({ holder: { name: 'Zed Nobody', isCurrent: true, sourceIds: [1, 2] } }), evidence, ctx),
    ).toBeNull();
  });

  it('rejects a holder marked as not current, null holders and malformed replies', () => {
    expect(parseExtraction(JSON.stringify({ holder: { name: 'Jeff Hale', isCurrent: false, sourceIds: [2] } }), evidence, ctx)).toBeNull();
    expect(parseExtraction(JSON.stringify({ holder: null }), evidence, ctx)).toBeNull();
    expect(parseExtraction('not json', evidence, ctx)).toBeNull();
    expect(parseExtraction(JSON.stringify({ holder: { name: 'Andy Corwin', isCurrent: true, sourceIds: [9] } }), evidence, ctx)).toBeNull();
  });

  it('extracts JSON wrapped in prose or a code fence', () => {
    const text = 'Here you go:\n```json\n{"holder":{"name":"Andy Corwin","isCurrent":true,"sourceIds":[2,3]}}\n```';
    expect(parseExtraction(text, evidence, ctx)?.sources).toBe(2);
  });
});

describe('extractHolderWithClaude', () => {
  it('returns the parsed holder', async () => {
    const holder = await extractHolderWithClaude(
      evidence,
      ctx,
      reply({ holder: { name: 'Andy Corwin', isCurrent: true, sourceIds: [1, 3] } }),
      {
        timeoutMs: 1000,
      },
    );
    expect(holder?.name).toBe('Andy Corwin');
  });

  it('returns null without calling the model when there is no evidence', async () => {
    let called = false;
    const llm: LlmClient = {
      complete: async () => {
        called = true;
        return '{}';
      },
    };
    expect(await extractHolderWithClaude([], ctx, llm, { timeoutMs: 1000 })).toBeNull();
    expect(called).toBe(false);
  });

  it('propagates model errors so the caller can fall back', async () => {
    const llm: LlmClient = { complete: async () => Promise.reject(new Error('402 Payment Required')) };
    await expect(extractHolderWithClaude(evidence, ctx, llm, { timeoutMs: 1000 })).rejects.toThrow(/402/);
  });
});
