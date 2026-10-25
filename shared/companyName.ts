// Works out a company's display name from its homepage HTML:
// og:site_name → cleaned <title> → capitalized domain.

import { domainToCompanyName } from './domain';
import type { CompanyNameSource } from './types';

const MAX_NAME_LENGTH = 80;
const GENERIC_SEGMENTS = new Set([
  'home',
  'homepage',
  'home page',
  'welcome',
  'official site',
  'official website',
  'index',
  'main',
  'start',
  'startseite',
  'начало',
  'начална страница',
  'inicio',
  'accueil',
]);
const TITLE_SEPARATORS = /\s+[|–—·•:»]\s+|\s+-\s+/;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  middot: '·',
  raquo: '»',
  laquo: '«',
  trade: '™',
  reg: '®',
  copy: '©',
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function clean(text: string): string {
  return decodeHtmlEntities(text).replace(/\s+/g, ' ').trim();
}

function usable(name: string): boolean {
  return name.length > 0 && name.length <= MAX_NAME_LENGTH && !GENERIC_SEGMENTS.has(name.toLowerCase());
}

function findOgSiteName(html: string): string | null {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    if (!/(?:property|name)\s*=\s*["']og:site_name["']/i.test(tag)) continue;
    const content = tag.match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i);
    const value = clean(content?.[1] ?? content?.[2] ?? '');
    if (usable(value)) return value;
  }
  return null;
}

function findTitleName(html: string, domain: string): string | null {
  const raw = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (!raw) return null;
  const title = clean(raw);
  if (!title || title.length > 300) return null;

  const segments = title
    .split(TITLE_SEPARATORS)
    .map((segment) => segment.replace(/^(?:welcome to|home of)\s+/i, '').trim())
    .filter(usable);
  if (segments.length === 0) return null;

  // Prefer the segment that contains the domain's name ("Paylane" for paylane.com).
  const domainKey = domainToCompanyName(domain).toLowerCase().replace(/\s+/g, '');
  const matching = segments.find((segment) => {
    const key = segment.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    return key.includes(domainKey) || (key.length >= 3 && domainKey.includes(key));
  });
  return matching ?? segments[0] ?? null;
}

export function resolveCompanyName(html: string | null, domain: string): { name: string; source: CompanyNameSource } {
  if (html) {
    const head = html.slice(0, 200_000);
    const og = findOgSiteName(head);
    if (og) return { name: og, source: 'og:site_name' };
    const title = findTitleName(head, domain);
    if (title) return { name: title, source: 'title' };
  }
  return { name: domainToCompanyName(domain), source: 'domain' };
}
