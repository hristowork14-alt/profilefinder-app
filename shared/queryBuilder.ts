// Builds the site:linkedin.com/in search queries.

const SITE = 'site:linkedin.com/in';

/** Removes characters that would break or hijack a quoted search phrase. */
function quote(term: string): string {
  const cleaned = term
    .replace(/["“”„]/g, '')
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return `"${cleaned}"`;
}

/** Query 3 — needs only the domain, so it can start before the company name is known. */
export function buildDomainQuery(domain: string, position: string): string {
  return `${SITE} ${quote(domain)} ${quote(position)}`;
}

/** Queries 1 and 2 — company name + position, and company name + the first synonym. */
export function buildNameQueries(companyName: string, position: string, synonyms: string[]): string[] {
  const queries = [`${SITE} ${quote(companyName)} ${quote(position)}`];
  const synonym = synonyms[0];
  if (synonym) queries.push(`${SITE} ${quote(companyName)} ${quote(synonym)}`);
  return queries;
}
