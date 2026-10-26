// Independent corroboration: who does the open web (company sites, press releases, news,
// dossiers — not LinkedIn) say holds the role?
//
// Why: anyone can type "CTO at Cloudflare" into their own LinkedIn headline. In production a
// search for cloudflare.com + CTO returned only such self-declared profiles, while an ordinary
// web search for "Cloudflare CTO" named the real CTO in several independent sources. Names that
// several sources agree on are used to (1) look that person up on LinkedIn and (2) tell the
// rankers which candidates are confirmed. This module only reads search-result text; it never
// fetches any page.

import { normalizePosition } from './positionSynonyms';
import type { RankingContext, SearchHit } from './types';

export interface EvidenceName {
  name: string;
  /** How many different search results name this person next to the role. */
  sources: number;
}

/** Names agreed on by at least this many sources count as corroborated. */
export const MIN_SOURCES = 2;
const MAX_NAMES = 3;
/** How close (in characters) a name must be to a mention of the role. */
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

const FORMER_BEFORE =
  /\b(?:former|formerly|previous|previously|ex|outgoing|retired|retiring|departing|predecessor|replaces|replacing|succeeds|succeeding)\b[\s\S]{0,12}$/i;

// A run of 2–4 capitalized words ("Mara Velin", "Jon Hale-Smith", "Žofia Dvořáková").
const NAME_RUN = /\p{Lu}[\p{Ll}\p{M}'’-]+(?:\s+\p{Lu}[\p{Ll}\p{M}'’-]+){1,3}/gu;

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function nameTokens(name: string): string[] {
  return fold(name)
    .replace(/['’]s\b/g, '')
    .split(/[^\p{L}-]+/u)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length > 1);
}

/** Same person: first and last name agree (accents, case and middle names ignored). */
export function namesMatch(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length < 2 || tb.length < 2) return false;
  return ta[0] === tb[0] && ta[ta.length - 1] === tb[tb.length - 1];
}

function roleTerms(ctx: RankingContext): string[] {
  return [ctx.position, ...ctx.synonyms].map((t) => t.trim()).filter((t) => t.length >= 2);
}

function rolePositions(text: string, terms: string[]): number[] {
  const positions: number[] = [];
  const lower = text.toLowerCase();
  for (const term of terms) {
    const needle = term.toLowerCase();
    let from = 0;
    for (;;) {
      const at = lower.indexOf(needle, from);
      if (at < 0) break;
      const before = lower[at - 1] ?? ' ';
      const after = lower[at + needle.length] ?? ' ';
      if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) positions.push(at, at + needle.length);
      from = at + needle.length;
    }
  }
  return positions;
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

/**
 * People named next to the role in search results that are not LinkedIn pages.
 * Sorted by how many different results name them. Only names with MIN_SOURCES or more are
 * returned, so one stray mention never counts as confirmation.
 */
export function extractNamedPeople(hits: SearchHit[], ctx: RankingContext): EvidenceName[] {
  const terms = roleTerms(ctx);
  const blocked = new Set(
    [...nameTokens(ctx.companyName), ...nameTokens(ctx.domain.split('.')[0] ?? ''), ...terms.flatMap((t) => nameTokens(t))].concat(
      normalizePosition(ctx.companyName).split(' '),
    ),
  );

  const counts = new Map<string, { name: string; sources: number }>();
  for (const hit of hits) {
    if (/(^|\.)linkedin\.com/i.test(safeHost(hit.url))) continue;
    const text = `${hit.title} . ${hit.snippet}`;
    const roles = rolePositions(text, terms);
    if (roles.length === 0) continue;

    const seenInHit = new Set<string>();
    for (const match of text.matchAll(NAME_RUN)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const near = roles.some((r) => r >= start - PROXIMITY && r <= end + PROXIMITY);
      if (!near) continue;
      if (FORMER_BEFORE.test(text.slice(Math.max(0, start - 30), start))) continue;
      const name = cleanRun(match[0], blocked);
      if (!name) continue;
      const key = nameTokens(name).join(' ');
      if (seenInHit.has(key)) continue;
      seenInHit.add(key);
      const entry = counts.get(key) ?? { name, sources: 0 };
      entry.sources += 1;
      counts.set(key, entry);
    }
  }

  return [...counts.values()]
    .filter((e) => e.sources >= MIN_SOURCES)
    .sort((a, b) => b.sources - a.sources)
    .slice(0, MAX_NAMES)
    .map(({ name, sources }) => ({ name, sources }));
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** How many sources name this candidate (0 if none). */
export function corroborationFor(candidateName: string, evidence: EvidenceName[]): number {
  return evidence.find((e) => namesMatch(e.name, candidateName))?.sources ?? 0;
}
