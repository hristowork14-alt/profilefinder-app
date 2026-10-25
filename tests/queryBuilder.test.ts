import { describe, expect, it } from 'vitest';
import { findSynonyms, normalizePosition } from '../shared/positionSynonyms';
import { buildDomainQuery, buildNameQueries } from '../shared/queryBuilder';

describe('normalizePosition', () => {
  it('lowercases, trims and collapses whitespace and punctuation', () => {
    expect(normalizePosition('  Head  of   Marketing ')).toBe('head of marketing');
    expect(normalizePosition('C.T.O.')).toBe('cto');
    expect(normalizePosition('VP, Engineering')).toBe('vp engineering');
  });
});

describe('findSynonyms', () => {
  it('maps abbreviations to full titles and back', () => {
    expect(findSynonyms('CTO')).toContain('Chief Technology Officer');
    expect(findSynonyms('chief technology officer')).toContain('CTO');
    expect(findSynonyms('CEO')).toEqual(expect.arrayContaining(['Chief Executive Officer', 'Founder']));
  });

  it('covers marketing and HR groups from the spec', () => {
    expect(findSynonyms('Head of Marketing')).toEqual(expect.arrayContaining(['VP Marketing', 'Marketing Director']));
    const hr = findSynonyms('HR');
    expect(hr.some((s) => /people/i.test(s))).toBe(true);
    expect(hr.some((s) => /talent/i.test(s))).toBe(true);
  });

  it('never returns the input itself and returns [] for unknown titles', () => {
    expect(findSynonyms('CTO').map((s) => s.toLowerCase())).not.toContain('cto');
    expect(findSynonyms('Chief Happiness Wizard')).toEqual([]);
  });
});

describe('query building', () => {
  it('builds the domain query', () => {
    expect(buildDomainQuery('acme.io', 'CTO')).toBe('site:linkedin.com/in "acme.io" "CTO"');
  });

  it('builds name + position and name + first synonym queries', () => {
    expect(buildNameQueries('Acme', 'CTO', ['Chief Technology Officer', 'VP Engineering'])).toEqual([
      'site:linkedin.com/in "Acme" "CTO"',
      'site:linkedin.com/in "Acme" "Chief Technology Officer"',
    ]);
  });

  it('builds a single name query when there are no synonyms', () => {
    expect(buildNameQueries('Acme', 'Chief Happiness Wizard', [])).toEqual(['site:linkedin.com/in "Acme" "Chief Happiness Wizard"']);
  });

  it('strips quotes and search operators from user input', () => {
    expect(buildDomainQuery('acme.io', 'CTO" OR "CEO')).toBe('site:linkedin.com/in "acme.io" "CTO OR CEO"');
    expect(buildNameQueries('Acme "Inc"', 'CTO', [])[0]).toBe('site:linkedin.com/in "Acme Inc" "CTO"');
  });
});
