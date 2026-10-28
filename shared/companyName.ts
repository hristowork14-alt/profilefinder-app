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
// " | ", " – ", " - " … and also "Cloudflare: Build…" (colon without a space before it) and
// sentence-style titles such as "Amazon.com. Spend less." A period only splits after 3+ letters or
// digits, so abbreviations like "Dr. Oetker" or "St. Pauli" stay whole.
const TITLE_SEPARATORS = /\s+[|–—·•»]\s+|\s+-\s+|\s*:\s+|(?<=[\p{L}\p{N}]{3})\.\s+/u;
/** A title segment longer than this, that doesn't mention the domain, is treated as a slogan. */
const MAX_UNMATCHED_WORDS = 4;

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

const SITE_WORDS = String.raw`(?:web\s?site|site|home\s?page|online\s+store|store)`;
/** "Official Ferrari website", "Orbitly Official Website", "The official site of Quiet Pine" → the brand. */
const OFFICIAL_WRAPPERS = [
  new RegExp(String.raw`^(?:the\s+)?official\s+${SITE_WORDS}\s+(?:of|for)\s+(.+)$`, 'i'),
  new RegExp(String.raw`^(?:the\s+)?official\s+(.+?)\s+${SITE_WORDS}$`, 'i'),
  new RegExp(String.raw`^(.+?)\s+official\s+${SITE_WORDS}$`, 'i'),
];

function unwrapOfficial(name: string): string {
  for (const pattern of OFFICIAL_WRAPPERS) {
    const brand = name.match(pattern)?.[1]?.trim();
    if (brand) return brand;
  }
  return name;
}

function usable(name: string): boolean {
  return name.length > 0 && name.length <= MAX_NAME_LENGTH && !GENERIC_SEGMENTS.has(name.toLowerCase());
}

function findOgSiteName(html: string): string | null {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    if (!/(?:property|name)\s*=\s*["']og:site_name["']/i.test(tag)) continue;
    const content = tag.match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i);
    const value = unwrapOfficial(clean(content?.[1] ?? content?.[2] ?? ''));
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
    .map((segment) =>
      unwrapOfficial(
        segment
          .replace(/^(?:welcome to|home of)\s+/i, '')
          .replace(/[.!]+$/, '')
          .trim(),
      ),
    )
    .filter(usable);
  if (segments.length === 0) return null;

  // Prefer the segment that contains the domain's name ("Paylane" for paylane.com).
  const domainName = domainToCompanyName(domain);
  const domainKey = domainName.toLowerCase().replace(/\s+/g, '');
  const matching = segments.find((segment) => {
    const key = segment.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    return key.includes(domainKey) || (key.length >= 3 && domainKey.includes(key));
  });
  if (matching) {
    // "Amazon.com" for amazon.com → "Amazon": people write the brand, not the address.
    return matching.toLowerCase() === domain.toLowerCase() ? domainName : matching;
  }

  // No segment names the company: keep a short one (brand differs from the domain), but treat a
  // long one as a slogan and let the caller fall back to the domain.
  const first = segments[0];
  return first && first.split(/\s+/).length <= MAX_UNMATCHED_WORDS ? first : null;
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

const MAX_ALIASES = 4;
const MIN_ALIAS_LENGTH = 3;
const ORGANIZATION_TYPES =
  /^(?:Organization|Corporation|Company|LocalBusiness|AutomotiveBusiness|OnlineBusiness|NGO|EducationalOrganization)$/i;

function jsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      blocks.push(JSON.parse(match[1] ?? ''));
    } catch {
      // Broken JSON-LD is common; skip it.
    }
  }
  return blocks;
}

/** Organization names in JSON-LD (name, legalName, alternateName), including inside @graph. */
function organizationNames(node: unknown, out: string[], depth = 0): void {
  if (depth > 4 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) organizationNames(item, out, depth + 1);
    return;
  }
  const record = node as Record<string, unknown>;
  const type = record['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => typeof t === 'string' && ORGANIZATION_TYPES.test(t))) {
    for (const key of ['name', 'legalName', 'alternateName']) {
      const value = record[key];
      for (const item of Array.isArray(value) ? value : [value]) if (typeof item === 'string') out.push(clean(item));
    }
  }
  if (record['@graph']) organizationNames(record['@graph'], out, depth + 1);
}

/**
 * Other names the company uses for itself on its own homepage — JSON-LD Organization names, the
 * og:site_name and title segments that contain the website's name. Used to search for and
 * recognise profiles that write the company differently ("Northwind Automobiles"). Never guessed:
 * only what the company's own site says.
 */
export function extractCompanyAliases(html: string | null, domain: string, companyName: string): string[] {
  if (!html) return [];
  const head = html.slice(0, 300_000);
  const candidates: string[] = [];
  for (const block of jsonLdBlocks(head)) organizationNames(block, candidates);
  const og = findOgSiteName(head);
  if (og) candidates.push(og);

  const domainKey = domainToCompanyName(domain).toLowerCase().replace(/\s+/g, '');
  const rawTitle = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (rawTitle) {
    for (const segment of clean(rawTitle).split(TITLE_SEPARATORS)) {
      const name = unwrapOfficial(segment.replace(/[.!]+$/, '').trim());
      if (
        usable(name) &&
        name
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]/gu, '')
          .includes(domainKey)
      )
        candidates.push(name);
    }
  }

  const seen = new Set<string>([companyName.toLowerCase(), domain.toLowerCase()]);
  const out: string[] = [];
  for (const name of candidates) {
    const key = name.toLowerCase();
    if (name.length < MIN_ALIAS_LENGTH || !usable(name) || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_ALIASES) break;
  }
  return out;
}

/** Words that, after a company's name, usually mean a different business ("Stripe Capital"). */
export const LOOKALIKE_SUFFIX_WORDS = [
  'group',
  'holding',
  'holdings',
  'capital',
  'ventures',
  'partners',
  'foundation',
  'bank',
  'studio',
  'studios',
  'consulting',
  'international',
];

const EMPLOYER_IN_TITLE = /(?:\bat|@)\s+([^|·,;()–—]+?)(?=\s*(?:$|[|·,;()–—]|\s-\s))/gi;

/**
 * Names that extend the company's name in LinkedIn headlines ("Mechanical Engineer at Northwind
 * Rimo" for Northwind) — the same brand family, worth searching for. Look-alike businesses
 * ("Northwind Capital") are left out.
 */
export function brandFamilyNames(titles: string[], companyName: string): string[] {
  const company = companyName.trim().toLowerCase();
  if (company.length < 2) return [];
  const counts = new Map<string, { name: string; count: number }>();
  for (const title of titles) {
    const text = title.replace(/\s*[|–—-]\s*LinkedIn\s*$/i, '');
    for (const match of text.matchAll(EMPLOYER_IN_TITLE)) {
      const org = clean(match[1] ?? '').replace(/[.]+$/, '');
      const lower = org.toLowerCase();
      if (!lower.startsWith(`${company} `)) continue;
      const extra = lower.slice(company.length + 1).split(/\s+/);
      if (extra.length > 2 || extra.some((w) => LOOKALIKE_SUFFIX_WORDS.includes(w))) continue;
      const entry = counts.get(lower) ?? { name: org, count: 0 };
      entry.count++;
      counts.set(lower, entry);
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .map((e) => e.name)
    .slice(0, 2);
}
