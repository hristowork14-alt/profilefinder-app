// Fixture search provider. Same interface as the Serper adapter, but it never touches the
// network: it turns the query into deterministic, fictional "Google results" that include
// the messy cases the real pipeline must handle (country subdomains, tracking parameters,
// locale suffixes, duplicates, non-profile pages, former employees, look-alike companies).

import { sleep } from '../deadline';
import { findSynonyms } from '../positionSynonyms';
import type { SearchHit, SearchProvider } from '../types';
import { EMPTY_COMPANY_KEY, SEARCH_DOWN_COMPANY_KEY, companyKeyFromTerm, displayNameFromTerm, fixturePeople } from './fixtures';
import { between, createRandom } from './random';

export interface MockOptions {
  /** 1 = realistic delays (~0.4–0.9 s per query), 0 = instant (tests). */
  latencyScale?: number;
}

function parseQuery(query: string): { companyTerm: string; positionTerm: string } {
  const terms = [...query.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '');
  return { companyTerm: terms[0] ?? '', positionTerm: terms[1] ?? '' };
}

export function createMockSearchProvider(options: MockOptions = {}): SearchProvider {
  const scale = options.latencyScale ?? 1;

  return {
    name: 'mock',
    async search(query, { signal, limit }) {
      const random = createRandom(query);
      await sleep(between(random, 400, 900) * scale, signal);

      const { companyTerm, positionTerm } = parseQuery(query);
      const companyKey = companyKeyFromTerm(companyTerm);
      if (companyKey === SEARCH_DOWN_COMPANY_KEY) throw new Error('Mock search API: 503 Service Unavailable');
      if (companyKey === EMPTY_COMPANY_KEY || !positionTerm) return [];

      const isDomainQuery = companyTerm.includes('.');
      const company = displayNameFromTerm(companyTerm);
      // The role the "found" people hold. For the synonym query this is the synonym itself.
      const role = positionTerm;
      const altRole = findSynonyms(positionTerm)[0] ?? `Interim ${positionTerm}`;
      const [lead, second, former, lookalike, engineer, deputy] = fixturePeople(companyKey, positionTerm);
      if (!lead || !second || !former || !lookalike || !engineer || !deputy) return [];

      const profile = (slug: string, variant: 'www' | 'country' | 'locale' | 'slash') =>
        variant === 'country'
          ? `https://bg.linkedin.com/in/${slug}?trk=public_profile_browsemap`
          : variant === 'locale'
            ? `https://www.linkedin.com/in/${slug}/en`
            : variant === 'slash'
              ? `https://www.linkedin.com/in/${slug}/`
              : `https://www.linkedin.com/in/${slug}`;

      const hits: SearchHit[] = isDomainQuery
        ? [
            {
              title: `${lead.name} - ${role} - ${company} | LinkedIn`,
              snippet: `${role} at ${company} (${companyTerm}). Location: ${lead.city}. 500+ connections on LinkedIn.`,
              url: profile(lead.slug, 'locale'),
            },
            {
              title: `${second.name} - ${altRole} at ${company} | LinkedIn`,
              snippet: `${altRole} · ${company} · ${companyTerm} · ${second.city}`,
              url: profile(second.slug, 'www'),
            },
            {
              title: `${former.name} - ${role} - ${former.other} | LinkedIn`,
              snippet: `Former ${role} at ${company} (2017–2022). Now ${role} at ${former.other}. ${former.city}.`,
              url: profile(former.slug, 'slash'),
            },
          ]
        : [
            {
              title: `${lead.name} - ${role} - ${company} | LinkedIn`,
              snippet: `${company} · ${role} · Experience: ${company} · Education: Sofia University · Location: ${lead.city} · 500+ connections on LinkedIn.`,
              url: profile(lead.slug, 'country'),
            },
            {
              title: `${second.name} - ${altRole} at ${company} | LinkedIn`,
              snippet: `${altRole} at ${company}. Previously at ${second.other}. ${second.city}.`,
              url: profile(second.slug, 'www'),
            },
            {
              title: `${company} | LinkedIn`,
              snippet: `${company} | 1,240 followers on LinkedIn. Company page.`,
              url: `https://www.linkedin.com/company/${companyKey}`,
            },
            {
              title: `${former.name} - ${role} - ${former.other} | LinkedIn`,
              snippet: `Former ${role} at ${company} (2017–2022). Now ${role} at ${former.other}. ${former.city}.`,
              url: profile(former.slug, 'www'),
            },
            {
              title: `${lookalike.name} - ${role} - ${company} Group | LinkedIn`,
              snippet: `${role} at ${company} Group Holdings Ltd (${companyKey}group.com), a separate business. ${lookalike.city}.`,
              url: profile(lookalike.slug, 'www'),
            },
            {
              title: `${engineer.name} - Senior Software Engineer - ${company} | LinkedIn`,
              snippet: `Senior Software Engineer at ${company}. Reports to the ${role}. ${engineer.city}.`,
              url: profile(engineer.slug, 'www'),
            },
            {
              title: `${deputy.name} - Deputy ${role} - ${company} | LinkedIn`,
              snippet: `Deputy ${role} at ${company} since 2023. ${deputy.city}.`,
              url: profile(deputy.slug, 'www'),
            },
            {
              title: `${lead.name} on LinkedIn: Hiring at ${company}`,
              snippet: `We're hiring! Join ${company}…`,
              url: `https://www.linkedin.com/posts/${lead.slug}_hiring-activity-7214`,
            },
          ];

      return hits.slice(0, limit);
    },
  };
}
