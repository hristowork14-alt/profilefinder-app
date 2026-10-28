// Builds the search queries: site:linkedin.com/in queries, and the independent-evidence web
// queries that exclude LinkedIn.

import { nameVariants } from './corroboration';

const SITE = 'site:linkedin.com/in';

/** Removes characters that would break or hijack a search phrase. */
function clean(term: string): string {
  return (
    term
      .replace(/["“”„]/g, '')
      // eslint-disable-next-line no-control-regex -- stripping control characters is the point
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100)
  );
}

function quote(term: string): string {
  return `"${clean(term)}"`;
}

/** True when the query searches for this exact (quoted) phrase, e.g. the company name. */
export function queryMentions(query: string, term: string): boolean {
  return query.includes(quote(term));
}

/**
 * Independent evidence, phrased as a question so Google shows its answer box / knowledge panel
 * ("who is the Chief Executive Officer of Orbitly"). LinkedIn is excluded.
 */
export function buildQuestionQuery(companyName: string, position: string): string {
  return `who is the ${clean(position)} of ${clean(companyName)} -site:linkedin.com`;
}

/**
 * LinkedIn lookups for a person independent sources named: name + company, the name alone (the
 * profile headline may not mention the company), and the most common other form of the first
 * name with the company ("Andy" ↔ "Andrew").
 */
export function buildPersonQueries(personName: string, companyName: string): string[] {
  const queries = [`${SITE} ${quote(personName)} ${quote(companyName)}`, `${SITE} ${quote(personName)}`];
  const variant = nameVariants(personName)[0];
  if (variant) queries.push(`${SITE} ${quote(variant)} ${quote(companyName)}`);
  return queries;
}

/** Query 3 — needs only the domain, so it can start before the company name is known. */
export function buildDomainQuery(domain: string, position: string): string {
  return `${SITE} ${quote(domain)} ${quote(position)}`;
}

/**
 * Independent evidence: an ordinary web search for who holds the role, with LinkedIn excluded,
 * so self-declared LinkedIn headlines can't dominate it. Only read as text (see corroboration.ts).
 */
export function buildEvidenceQuery(companyName: string, position: string): string {
  return `${quote(companyName)} ${quote(position)} -site:linkedin.com`;
}

/** Finds the LinkedIn profile of a person that independent sources named. */
export function buildPersonQuery(personName: string, companyName: string): string {
  return `${SITE} ${quote(personName)} ${quote(companyName)}`;
}

/** A verified person by name and role, for finding their profile when the name and company together find nothing. */
export function buildPersonRoleQuery(personName: string, role: string): string {
  return `${SITE} ${quote(personName)} ${quote(role)}`;
}

/** One company name (or alias) with one form of the title. */
export function buildNameQuery(companyName: string, title: string): string {
  return `${SITE} ${quote(companyName)} ${quote(title)}`;
}

/** Looser: the words without quotes, so Google can match them anywhere and in any order. */
export function buildLooseQuery(companyName: string, title: string): string {
  return `${SITE} ${clean(companyName)} ${clean(title)}`;
}

/** Queries 1 and 2 — company name + position, and company name + the first synonym. */
export function buildNameQueries(companyName: string, position: string, synonyms: string[]): string[] {
  const queries = [`${SITE} ${quote(companyName)} ${quote(position)}`];
  const synonym = synonyms[0];
  if (synonym) queries.push(`${SITE} ${quote(companyName)} ${quote(synonym)}`);
  return queries;
}
