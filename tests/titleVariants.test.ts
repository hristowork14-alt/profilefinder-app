import { describe, expect, it } from 'vitest';
import {
  buildVariantPrompt,
  clearVariantCache,
  generateVariants,
  languageFromHomepage,
  languagesFromHits,
  parseVariants,
  ruleVariants,
} from '../shared/titleVariants';
import type { LlmClient } from '../shared/types';

describe('ruleVariants', () => {
  it('derives the usual headline forms of a title, without repeating it', () => {
    const variants = ruleVariants('Mechanical Engineer');
    expect(variants).toContain('Mechanical Engineering');
    expect(variants).toContain('Mechanical Design Engineer');
    expect(variants).not.toContain('Mechanical Engineer');
  });

  it('drops seniority words, so "Senior Data Analyst" also finds "Data Analyst"', () => {
    expect(ruleVariants('Senior Data Analyst')).toContain('Data Analyst');
    expect(ruleVariants('Sr. Backend Developer')).toContain('Backend Developer');
  });

  it('maps the role noun to its field ("Developer" → "Development", "Recruiter" → "Recruitment")', () => {
    expect(ruleVariants('Backend Developer')).toContain('Backend Development');
    expect(ruleVariants('Technical Recruiter')).toContain('Technical Recruitment');
  });

  it('returns nothing odd for one-word or unknown titles', () => {
    expect(ruleVariants('CEO')).toEqual([]);
    expect(ruleVariants('Engineer')).toEqual([]);
  });
});

describe('languagesFromHits', () => {
  it('reads the languages of the LinkedIn country sites the profiles came from, most common first, English left out', () => {
    const urls = [
      'https://hr.linkedin.com/in/a',
      'https://hr.linkedin.com/in/b',
      'https://fr.linkedin.com/in/c',
      'https://www.linkedin.com/in/d',
      'https://uk.linkedin.com/in/e',
      'https://example.com/x',
    ];
    expect(languagesFromHits(urls.map((url) => ({ url, title: '', snippet: '' })))).toEqual(['hr', 'fr']);
  });
});

describe('languageFromHomepage', () => {
  it('reads <html lang>, ignoring English', () => {
    expect(languageFromHomepage('<html lang="fr-FR"><head>')).toBe('fr');
    expect(languageFromHomepage('<html class="x" lang="de">')).toBe('de');
    expect(languageFromHomepage('<html lang="en-US">')).toBeNull();
    expect(languageFromHomepage(null)).toBeNull();
  });
});

describe('parseVariants', () => {
  it('keeps short, plain titles and drops anything that could change the search', () => {
    const text = JSON.stringify({
      variants: [
        'Mechanical Design Engineer',
        'Ingénieur mécanique',
        'Strojarski inženjer',
        'x" OR site:evil.com',
        'Mechanical Engineer',
        'a'.repeat(80),
        'Engineer: mechanical',
        '',
      ],
    });
    expect(parseVariants(text, 'Mechanical Engineer')).toEqual([
      'Mechanical Design Engineer',
      'Ingénieur mécanique',
      'Strojarski inženjer',
    ]);
  });

  it('returns [] for anything that is not the expected JSON', () => {
    expect(parseVariants('not json', 'X')).toEqual([]);
    expect(parseVariants('{"variants": "nope"}', 'X')).toEqual([]);
  });
});

describe('generateVariants', () => {
  it('asks for translations into the given languages, and caches per title and languages', async () => {
    clearVariantCache();
    const prompts: string[] = [];
    const llm: LlmClient = {
      complete: async ({ prompt }) => {
        prompts.push(prompt);
        return JSON.stringify({ variants: ['Ingénieur mécanique', 'Mechanical Design Engineer'] });
      },
    };
    const first = await generateVariants('Mechanical Engineer', ['fr'], llm, { timeoutMs: 1000 });
    const second = await generateVariants('mechanical engineer', ['fr'], llm, { timeoutMs: 1000 });
    expect(first).toEqual(['Ingénieur mécanique', 'Mechanical Design Engineer']);
    expect(second).toEqual(first);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatch(/French/);
  });

  it('returns [] instead of failing when the model errors', async () => {
    clearVariantCache();
    const llm: LlmClient = { complete: async () => Promise.reject(new Error('timeout')) };
    expect(await generateVariants('Data Analyst', ['de'], llm, { timeoutMs: 1000 })).toEqual([]);
  });

  it('builds a prompt that only asks for titles, as JSON', () => {
    const { system, prompt } = buildVariantPrompt('Data Analyst', ['de', 'hr']);
    expect(system).toMatch(/JSON/);
    expect(prompt).toMatch(/German/);
    expect(prompt).toMatch(/Croatian/);
  });
});
