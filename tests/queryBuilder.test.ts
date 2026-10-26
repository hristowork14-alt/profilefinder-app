import { describe, expect, it } from 'vitest';
import { findSynonyms, normalizePosition } from '../shared/positionSynonyms';
import {
  buildDomainQuery,
  buildEvidenceQuery,
  buildNameQueries,
  buildPersonQueries,
  buildPersonQuery,
  buildQuestionQuery,
} from '../shared/queryBuilder';

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

  it('builds the independent-evidence web query, excluding LinkedIn', () => {
    expect(buildEvidenceQuery('Cloudflare', 'CTO')).toBe('"Cloudflare" "CTO" -site:linkedin.com');
  });

  it('builds the LinkedIn query for a person named by independent sources', () => {
    expect(buildPersonQuery('Dane Knecht', 'Cloudflare')).toBe('site:linkedin.com/in "Dane Knecht" "Cloudflare"');
    expect(buildPersonQuery('Dane "x" Knecht', 'Cloud"flare')).toBe('site:linkedin.com/in "Dane x Knecht" "Cloudflare"');
  });

  it('builds the natural-language evidence query that triggers answer boxes', () => {
    expect(buildQuestionQuery('Orbitly', 'Chief Executive Officer')).toBe(
      'who is the Chief Executive Officer of Orbitly -site:linkedin.com',
    );
    expect(buildQuestionQuery('Or"bitly', 'CEO" OR "x')).toBe('who is the CEO OR x of Orbitly -site:linkedin.com');
  });

  it('builds several profile lookups for a verified name, including a nickname form', () => {
    expect(buildPersonQueries('Andy Corwin', 'Orbitly')).toEqual([
      'site:linkedin.com/in "Andy Corwin" "Orbitly"',
      'site:linkedin.com/in "Andy Corwin"',
      'site:linkedin.com/in "Andrew Corwin" "Orbitly"',
    ]);
    expect(buildPersonQueries('Mara Velin', 'Orbitly')).toEqual([
      'site:linkedin.com/in "Mara Velin" "Orbitly"',
      'site:linkedin.com/in "Mara Velin"',
    ]);
  });

  it('strips quotes and search operators from user input', () => {
    expect(buildDomainQuery('acme.io', 'CTO" OR "CEO')).toBe('site:linkedin.com/in "acme.io" "CTO OR CEO"');
    expect(buildNameQueries('Acme "Inc"', 'CTO', [])[0]).toBe('site:linkedin.com/in "Acme Inc" "CTO"');
  });
});
