import { describe, expect, it } from 'vitest';
import { parseLinkedInTitle, rankHeuristically } from '../shared/heuristicRanker';
import type { Candidate, RankingContext } from '../shared/types';

const ctx: RankingContext = {
  companyName: 'Stripe',
  domain: 'stripe.com',
  position: 'CFO',
  synonyms: ['Chief Financial Officer', 'VP Finance'],
};

const candidate = (slug: string, title: string, snippet = ''): Candidate => ({
  slug,
  title,
  snippet,
  linkedinUrl: `https://www.linkedin.com/in/${slug}`,
});

describe('parseLinkedInTitle', () => {
  it('splits name and headline', () => {
    expect(parseLinkedInTitle('Jane Doe - CFO - Stripe | LinkedIn')).toEqual({ name: 'Jane Doe', headline: 'CFO - Stripe' });
    expect(parseLinkedInTitle('Jane Doe – Chief Financial Officer at Stripe – LinkedIn')).toEqual({
      name: 'Jane Doe',
      headline: 'Chief Financial Officer at Stripe',
    });
    expect(parseLinkedInTitle('Jane Doe | LinkedIn')).toEqual({ name: 'Jane Doe', headline: '' });
  });
});

describe('rankHeuristically', () => {
  const candidates = [
    candidate('former-cfo', 'Ann Former - Ex-CFO at Stripe | LinkedIn', 'Former CFO at Stripe (2016–2020).'),
    candidate('current-cfo', 'Jane Doe - CFO - Stripe | LinkedIn', 'Stripe · CFO · San Francisco'),
    candidate('synonym', 'Bob Roe - Chief Financial Officer at Stripe | LinkedIn', ''),
    candidate('other-company', 'Carl Poe - CFO - Acme | LinkedIn', 'CFO at Acme Corp.'),
    candidate('unrelated', 'Dana Zoe - Software Engineer - Stripe | LinkedIn', 'Engineer at Stripe'),
  ];

  const ranked = rankHeuristically(candidates, ctx);

  it('puts the current exact-title match first', () => {
    expect(ranked[0]?.linkedinUrl).toBe('https://www.linkedin.com/in/current-cfo');
    expect(ranked[0]?.fullName).toBe('Jane Doe');
    expect(ranked[0]?.confidence).toBeGreaterThanOrEqual(75);
  });

  it('scores synonym matches above former employees', () => {
    const score = (slug: string) => ranked.find((r) => r.linkedinUrl.endsWith(`/${slug}`))?.confidence ?? 0;
    expect(score('synonym')).toBeGreaterThan(score('former-cfo'));
    expect(score('synonym')).toBeGreaterThanOrEqual(50);
  });

  it('penalizes former employees and other companies', () => {
    const former = ranked.find((r) => r.linkedinUrl.endsWith('/former-cfo'));
    if (former) expect(former.confidence).toBeLessThan(50);
    expect(ranked.find((r) => r.linkedinUrl.endsWith('/other-company'))).toBeUndefined();
  });

  it('returns at most 5 results, sorted, each with a reason, using only given URLs', () => {
    expect(ranked.length).toBeLessThanOrEqual(5);
    const urls = new Set(candidates.map((c) => c.linkedinUrl));
    for (let i = 0; i < ranked.length; i++) {
      const item = ranked[i]!;
      expect(urls.has(item.linkedinUrl)).toBe(true);
      expect(item.reasoning.length).toBeGreaterThan(5);
      if (i > 0) expect(ranked[i - 1]!.confidence).toBeGreaterThanOrEqual(item.confidence);
    }
  });

  it('ranks deputies and look-alike companies below the real role holder', () => {
    const tricky = rankHeuristically(
      [
        candidate('main', 'Jane Doe - CFO - Stripe | LinkedIn'),
        candidate('deputy', 'Ian Deputy - Deputy CFO - Stripe | LinkedIn'),
        candidate('group', 'Gina Group - CFO - Stripe Group | LinkedIn', 'CFO at Stripe Group Holdings Ltd'),
      ],
      ctx,
    );
    const score = (slug: string) => tricky.find((r) => r.linkedinUrl.endsWith(`/${slug}`))?.confidence ?? 0;
    expect(score('main')).toBeGreaterThan(score('deputy'));
    expect(score('main')).toBeGreaterThan(score('group'));
    expect(score('deputy')).toBeLessThan(75);
    expect(score('group')).toBeLessThan(50);
  });

  it('does not count "reports to the CFO" as holding the role', () => {
    const result = rankHeuristically(
      [candidate('eng', 'Eve Eng - Accountant - Stripe | LinkedIn', 'Accountant at Stripe. Reports to the Chief Financial Officer.')],
      ctx,
    );
    expect(result).toEqual([]);
  });

  it('does not treat "previously at another company" as a former employee of this one', () => {
    const result = rankHeuristically([candidate('p', 'Pat Lee - CFO - Stripe | LinkedIn', 'CFO at Stripe. Previously at Acme.')], ctx);
    expect(result[0]?.confidence).toBeGreaterThanOrEqual(75);
  });

  it('returns an empty list when nothing matches', () => {
    expect(rankHeuristically([candidate('x', 'Someone - Baker - Bakery | LinkedIn')], ctx)).toEqual([]);
  });
});

describe('rankHeuristically for roles many people hold (real app)', () => {
  const ctx = {
    companyName: 'Northwind',
    domain: 'northwind.com',
    position: 'Mechanical Engineer',
    synonyms: [],
    manyHolders: true,
    aliases: ['Northwind Automobiles'],
    variants: ['Ingénieur mécanique', 'Mechanical Design Engineer'],
  };
  const make = (i: number, title: string, snippet = '') => ({
    title,
    snippet,
    slug: `p-${i}`,
    linkedinUrl: `https://www.linkedin.com/in/p-${i}`,
  });

  it('recognises title variants, translations and the company’s other names', () => {
    const out = rankHeuristically(
      [
        make(1, 'Ana Kos - Ingénieur mécanique - Northwind Automobiles | LinkedIn'),
        make(2, 'Ivo Bar - Mechanical Design Engineer at Northwind | LinkedIn'),
        make(3, 'Zed Q - Accountant at Northwind | LinkedIn'),
      ],
      ctx,
    );
    expect(out.map((r) => r.fullName)).toEqual(['Ana Kos', 'Ivo Bar']);
    expect(out.every((r) => r.confidence >= 50)).toBe(true);
  });

  it('returns up to the requested number of results', async () => {
    const people = Array.from({ length: 30 }, (_, i) => make(i, `Person ${i} - Mechanical Engineer at Northwind | LinkedIn`));
    expect(rankHeuristically(people, ctx, { maxResults: 25 })).toHaveLength(25);
    expect(rankHeuristically(people, ctx)).toHaveLength(5);
  });
});
