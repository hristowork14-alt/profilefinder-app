// Independent corroboration: who does the open web (company sites, press releases, news,
// dossiers — not LinkedIn) say holds the role?
//
// Why: anyone can type "CTO at Cloudflare" into their own LinkedIn headline. In production a
// search for cloudflare.com + CTO returned only such self-declared profiles, while an ordinary
// web search for "Cloudflare CTO" named the real CTO in several independent sources. Names that
// several sources agree on are used to (1) look that person up on LinkedIn and (2) decide which
// candidates are confirmed. This module only reads search-result text; it never fetches a page.

import { otherFirstNames, sameFirstName } from './nicknames';
import { normalizePosition } from './positionSynonyms';
import type { RankingContext, SearchHit, SourceLink } from './types';

export interface EvidenceName {
  name: string;
  /** Distinct supporting search results; one on the company's own domain counts double. */
  sources: number;
  /** Up to 3 supporting pages, official ones first (title + URL from the search result). */
  links?: SourceLink[];
  /** Hosts of the supporting pages, official ones first (for diagnostics). */
  hosts?: string[];
}

/** Names with at least this much (weighted) support count as corroborated. */
export const MIN_SOURCES = 2;
const MAX_NAMES = 3;
const MAX_LINKS = 3;
/** How close (in characters, within one sentence) a name must be to a mention of the role. */
const PROXIMITY = 70;

// Capitalized words that start or end "names" in titles but are not people.
const NOT_NAME_WORDS = new Set([
  'a',
  'about',
  'and',
  'announces',
  'appoints',
  'apply',
  'at',
  'bio',
  'biography',
  'board',
  'business',
  'by',
  'careers',
  'chief',
  'co',
  'company',
  'contact',
  'corp',
  'corporation',
  'director',
  'executive',
  'financial',
  'for',
  'founder',
  'from',
  'global',
  'group',
  'head',
  'how',
  'in',
  'inc',
  'interview',
  'is',
  'jobs',
  'leadership',
  'linkedin',
  'llc',
  'ltd',
  'management',
  'marketing',
  'meet',
  'named',
  'names',
  'new',
  'news',
  'now',
  'of',
  'officer',
  'on',
  'operating',
  'our',
  'people',
  'president',
  'press',
  'profile',
  'read',
  'release',
  'remote',
  'senior',
  'staff',
  'states',
  'technology',
  'the',
  'team',
  'to',
  'today',
  'united',
  'vice',
  'who',
  'wikipedia',
  'wire',
  'with',
  'year',
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

/** Words right before a name that mean the person is NOT the current holder. */
const FORMER_BEFORE_NAME =
  /\b(?:former|formerly|previous|previously|ex|outgoing|retired|retiring|departing|predecessor|replaces|replaced|replacing|succeeds|succeeded|succeeding|after)\b[\s\S]{0,12}$/i;
/** Words right before a role mention that make it a past role ("former CEO", "the ex-CEO"). */
const FORMER_BEFORE_ROLE = /\b(?:former|formerly|ex|previous|previously|outgoing|retired|retiring|departing|then|past|founding)[\s-]*$/i;

// One capitalized name word, including "O'Mara", "D'Angelo", "McDonald", "MacArthur" and
// double-barrelled "Smith-Jones" (each part capitalized).
const NAME_WORD = String.raw`(?:Mc|Mac|O['’]|D['’])?\p{Lu}[\p{Ll}\p{M}'’]+(?:-\p{Lu}?[\p{Ll}\p{M}'’]+)*`;
// A run of 2–4 capitalized words ("Mara Velin", "Jon Hale-Smith", "Žofia Dvořáková").
const NAME_RUN = new RegExp(`${NAME_WORD}(?:\\s+${NAME_WORD}){1,3}`, 'gu');
const ACRONYM_STOPWORDS = new Set(['of', 'and', '&', 'the', 'for']);

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Lowercase name tokens: accents folded, possessive and initials dropped, "Last, First" reordered. */
function nameTokens(name: string): string[] {
  const parts = name.split(',');
  const ordered = parts.length === 2 && parts.every((p) => /\p{L}/u.test(p)) ? `${parts[1]} ${parts[0]}` : name;
  return fold(ordered)
    .replace(/['’]s\b/g, '')
    .split(/[^\p{L}-]+/u)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length > 1);
}

/** Same person: same last name, and the same first name or a common nickname of it. */
export function namesMatch(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length < 2 || tb.length < 2) return false;
  return sameFirstName(ta[0]!, tb[0]!) && ta[ta.length - 1] === tb[tb.length - 1];
}

/** Other spellings of a name worth searching for ("Andy Corwin" → ["Andrew Corwin"]). */
export function nameVariants(name: string): string[] {
  const words = name.trim().split(/\s+/);
  const first = words[0];
  if (!first || words.length < 2) return [];
  const rest = words.slice(1).join(' ');
  return otherFirstNames(fold(first)).map((alt) => `${alt.charAt(0).toUpperCase()}${alt.slice(1)} ${rest}`);
}

function acronym(title: string): string {
  return title
    .split(/\s+/)
    .filter((w) => w && !ACRONYM_STOPWORDS.has(w.toLowerCase()))
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function isAcronymPair(a: string, b: string): boolean {
  const isShort = (t: string) => /^[A-Z]{2,5}$/.test(t.trim());
  if (isShort(a) && !isShort(b)) return acronym(b) === a.trim();
  if (isShort(b) && !isShort(a)) return acronym(a) === b.trim();
  return false;
}

/**
 * Role words used to read evidence: the position plus exact equivalents only (CEO ↔ Chief
 * Executive Officer). Looser related titles (Founder, Managing Director, VP Engineering) are left
 * out, because "Amazon founder" is not evidence of who is CEO today.
 */
export function evidenceRoleTerms(position: string, synonyms: string[]): string[] {
  return [position, ...synonyms.filter((s) => isAcronymPair(position, s))].map((t) => t.trim()).filter((t) => t.length >= 2);
}

interface RoleMention {
  start: number;
  end: number;
  former: boolean;
}

function roleMentions(text: string, terms: string[]): RoleMention[] {
  const mentions: RoleMention[] = [];
  const lower = text.toLowerCase();
  for (const term of terms) {
    const needle = term.toLowerCase();
    let from = 0;
    for (;;) {
      const at = lower.indexOf(needle, from);
      if (at < 0) break;
      const before = lower[at - 1] ?? ' ';
      const after = lower[at + needle.length] ?? ' ';
      if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) {
        mentions.push({ start: at, end: at + needle.length, former: FORMER_BEFORE_ROLE.test(text.slice(Math.max(0, at - 20), at)) });
      }
      from = at + needle.length;
    }
  }
  return mentions;
}

/** Trims non-name words from both ends of a capitalized run; null if fewer than 2 words remain. */
function cleanRun(run: string, blocked: Set<string>): string | null {
  const words = run.split(/\s+/).map((w) => w.replace(/['’]s$/u, ''));
  const isBlocked = (w: string) => NOT_NAME_WORDS.has(fold(w)) || blocked.has(fold(w));
  while (words.length && isBlocked(words[0]!)) words.shift();
  while (words.length && isBlocked(words[words.length - 1]!)) words.pop();
  if (words.length < 2 || words.length > 3 || words.some(isBlocked)) return null;
  return words.join(' ');
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** A page on the company's own website (e.g. ir.orbitly.com for orbitly.com). */
export function isOfficialHost(host: string, domain: string): boolean {
  const d = domain.toLowerCase();
  return host === d || host.endsWith(`.${d}`);
}

/** Title and each sentence of the snippet are read separately, so roles don't leak across sentences. */
function segments(hit: SearchHit): string[] {
  return [hit.title, ...hit.snippet.split(/(?<=[.!])\s+|\s+·\s+/)].filter((s) => s.trim().length > 0);
}

/** Names mentioned right next to a current (not "former") mention of the role in one hit. */
function namesInHit(hit: SearchHit, terms: string[], blocked: Set<string>): Map<string, string> {
  const found = new Map<string, string>();
  for (const text of segments(hit)) {
    const roles = roleMentions(text, terms);
    if (roles.length === 0) continue;
    for (const match of text.matchAll(NAME_RUN)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const distance = (r: RoleMention) => (r.start >= end ? r.start - end : r.end <= start ? start - r.end : 0);
      const nearest = roles.reduce((best, r) => (distance(r) < distance(best) ? r : best));
      if (distance(nearest) > PROXIMITY || nearest.former) continue;
      if (FORMER_BEFORE_NAME.test(text.slice(Math.max(0, start - 30), start))) continue;
      const name = cleanRun(match[0], blocked);
      if (!name) continue;
      const key = nameTokens(name).join(' ');
      if (!found.has(key)) found.set(key, name);
    }
  }
  return found;
}

/**
 * People named next to the role in search results that are not LinkedIn pages, sorted by
 * support. Each page counts once (even if several queries return it), and a page on the
 * company's own domain counts double. Only names with MIN_SOURCES support are returned, so one
 * stray mention never counts as confirmation.
 */
export function extractNamedPeople(hits: SearchHit[], ctx: RankingContext): EvidenceName[] {
  const terms = evidenceRoleTerms(ctx.position, ctx.synonyms);
  const blocked = new Set(
    [...nameTokens(ctx.companyName), ...nameTokens(ctx.domain.split('.')[0] ?? ''), ...terms.flatMap((t) => nameTokens(t))].concat(
      normalizePosition(ctx.companyName).split(' '),
    ),
  );

  const seenUrls = new Set<string>();
  const tally = new Map<string, { name: string; sources: number; pages: { link: SourceLink; host: string; official: boolean }[] }>();
  for (const hit of hits) {
    const host = safeHost(hit.url);
    if (/(^|\.)linkedin\.com$/.test(host) || seenUrls.has(hit.url)) continue;
    seenUrls.add(hit.url);
    const official = isOfficialHost(host, ctx.domain);
    for (const [key, name] of namesInHit(hit, terms, blocked)) {
      const entry = tally.get(key) ?? { name, sources: 0, pages: [] };
      entry.sources += official ? 2 : 1;
      entry.pages.push({ link: { title: hit.title.slice(0, 200), url: hit.url }, host, official });
      tally.set(key, entry);
    }
  }

  return [...tally.values()]
    .filter((e) => e.sources >= MIN_SOURCES)
    .sort((a, b) => b.sources - a.sources)
    .slice(0, MAX_NAMES)
    .map(({ name, sources, pages }) => {
      const ordered = [...pages].sort((a, b) => Number(b.official) - Number(a.official));
      return {
        name,
        sources,
        links: ordered.slice(0, MAX_LINKS).map((p) => p.link),
        hosts: [...new Set(ordered.map((p) => p.host))],
      };
    });
}

/** How much support this candidate has (0 if none). */
export function corroborationFor(candidateName: string, evidence: EvidenceName[]): number {
  return evidence.find((e) => namesMatch(e.name, candidateName))?.sources ?? 0;
}
