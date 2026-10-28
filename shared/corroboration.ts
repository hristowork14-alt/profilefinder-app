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
import { isJobPage, isOfficialHost, mentionsCompany, summarizeSupport, type SupportPage } from './sourceQuality';
import type { RankingContext, SearchHit, SourceLink } from './types';

export { isOfficialHost } from './sourceQuality';

export interface EvidenceName {
  name: string;
  /**
   * Weighted support: one point per supporting website, two for the company's own website, at
   * most one for all weak sites together (see sourceQuality.ts).
   */
  sources: number;
  /** Distinct supporting websites (what the user is told). */
  sites?: number;
  /** Distinct non-weak supporting websites. A person is confirmed only if this is at least 1. */
  strongSites?: number;
  /** Up to 3 supporting pages, one per website, official first, each with the sentence that names the person. */
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
/** "… was the CTO", "… had been CEO": a past role. */
const PAST_TENSE_BEFORE_ROLE = /\b(?:was|were|had been)\s+(?:the\s+|a\s+|an\s+|its\s+|their\s+)?$/i;
/** "CTO … until 2024": a role that ended. */
const ENDED_AFTER_ROLE = /^[^.;!?]{0,40}?\buntil\s+(?:(?:early|mid|late|the end of)\s+)?(?:[a-z]+\s+)?(?:19|20)\d\d\b/i;
/** Words right before a role mention that make it a different role ("Vice President", "assistant to the CEO"). */
const OTHER_ROLE_BEFORE =
  /\b(?:vice|deputy|assistant|associate|interim|acting|sub|regional|divisional|office of the|(?:assistant|staff|advis[eo]r|reports?|reporting)\s+to(?:\s+the)?)[\s-]*$/i;
/** Words right after a name that mean the person left the role. */
const LEFT_AFTER_NAME =
  /\b(?:stepped down|steps down|stepping down|step down|resign(?:ed|s|ing)?|depart(?:ed|s|ing)|retir(?:ed|es|ing)|left)\b/i;
/** "CTO at Quillstone", "head of design of Orbitly": the organisation the role is stated at. */
const ORG_AFTER_ROLE = /^\s*,?\s*(?:at|of|@|for)\s+(?:the\s+)?(\p{Lu}[\p{L}\p{N}&.'’+-]*(?:\s+[\p{Lu}\p{N}&][\p{L}\p{N}&.'’+-]*){0,3})/u;
/** "Quillstone's head of design": the organisation before the role. */
const ORG_BEFORE_ROLE = /(\p{Lu}[\p{L}\p{N}&.'’+-]*(?:\s+\p{Lu}[\p{L}\p{N}&.'’+-]*){0,3})['’]s\s+(?:new\s+|current\s+|own\s+)?$/u;
/** Capitalized words after "of/at" that are not organisations ("CEO of the Year"). */
const NOT_ORG_WORDS = new Set([
  'year',
  'month',
  'company',
  'board',
  'group',
  'firm',
  'team',
  'business',
  'organization',
  'organisation',
  'world',
  'our',
  'its',
  'their',
  'this',
  'that',
]);

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
  /** A past role or a different role ("Vice President"): never evidence. */
  former: boolean;
  /** The role is stated at another organisation ("head of design at Quillstone"): never evidence. */
  otherOrg: boolean;
}

type CompanyRef = Pick<RankingContext, 'companyName' | 'domain'>;

/** The organisation the text attaches this role mention to, if it names one. */
function statedOrg(text: string, start: number, end: number): string | null {
  const after = ORG_AFTER_ROLE.exec(text.slice(end));
  const before = ORG_BEFORE_ROLE.exec(text.slice(Math.max(0, start - 60), start));
  const org = (after?.[1] ?? before?.[1] ?? '').replace(/[.'’]+$/u, '').trim();
  if (!org) return null;
  const first = fold(org).split(/\s+/)[0] ?? '';
  return NOT_ORG_WORDS.has(first) ? null : org;
}

function isThisCompany(org: string, company: CompanyRef): boolean {
  if (mentionsCompany(org, company)) return true;
  const orgKey = normalizePosition(org);
  return orgKey.length >= 3 && ` ${normalizePosition(company.companyName)} `.includes(` ${orgKey} `);
}

function roleMentions(text: string, terms: string[], company?: CompanyRef): RoleMention[] {
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
        const end = at + needle.length;
        const lead = text.slice(Math.max(0, at - 30), at);
        const org = company ? statedOrg(text, at, end) : null;
        const former =
          FORMER_BEFORE_ROLE.test(lead) ||
          PAST_TENSE_BEFORE_ROLE.test(lead) ||
          OTHER_ROLE_BEFORE.test(lead) ||
          ENDED_AFTER_ROLE.test(text.slice(end));
        const otherOrg = org !== null && company !== undefined && !isThisCompany(org, company);
        mentions.push({ start: at, end, former, otherOrg });
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

/** Title and each sentence of the snippet are read separately, so roles don't leak across sentences. */
function segments(hit: SearchHit): string[] {
  return [hit.title, ...hit.snippet.split(/(?<=[.!])\s+|\s+·\s+/)].filter((s) => s.trim().length > 0);
}

/**
 * A search result that may count as evidence: not LinkedIn, not a job ad, and about this company
 * (it names the company or is on the company's own website).
 */
export function isUsableEvidence(hit: SearchHit, ctx: CompanyRef): boolean {
  const host = safeHost(hit.url);
  if (!host || /(^|\.)linkedin\.com$/.test(host) || isJobPage(hit.url, hit.title)) return false;
  return isOfficialHost(host, ctx.domain) || mentionsCompany(`${hit.title} ${hit.snippet}`, ctx);
}

/** Names mentioned right next to a current mention of the role (at this company) in one hit, with that sentence. */
function namesInHit(
  hit: SearchHit,
  terms: string[],
  blocked: Set<string>,
  company: CompanyRef,
): Map<string, { name: string; quote: string }> {
  const found = new Map<string, { name: string; quote: string }>();
  for (const text of segments(hit)) {
    const roles = roleMentions(text, terms, company);
    if (roles.length === 0) continue;
    for (const match of text.matchAll(NAME_RUN)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const distance = (r: RoleMention) => (r.start >= end ? r.start - end : r.end <= start ? start - r.end : 0);
      const nearest = roles.reduce((best, r) => (distance(r) < distance(best) ? r : best));
      if (distance(nearest) > PROXIMITY || nearest.former || nearest.otherOrg) continue;
      if (FORMER_BEFORE_NAME.test(text.slice(Math.max(0, start - 30), start))) continue;
      if (LEFT_AFTER_NAME.test(text.slice(end, end + 40))) continue;
      const name = cleanRun(match[0], blocked);
      if (!name) continue;
      const key = nameTokens(name).join(' ');
      if (!found.has(key)) found.set(key, { name, quote: text.trim() });
    }
  }
  return found;
}

/**
 * The sentence of a search result that supports "this person holds the role here now", or null.
 * Used to check the results Claude cites: Claude reads phrasings the regex can't, so a sentence
 * that names the person without the role still counts — unless the result ties the person to the
 * role at another organisation or says they left.
 */
export function hitNamesHolder(hit: SearchHit, name: string, ctx: RankingContext): string | null {
  const terms = evidenceRoleTerms(ctx.position, ctx.synonyms);
  const needle = fold(name.trim());
  if (nameTokens(name).length < 2) return null;
  let current: string | null = null;
  let fallback: string | null = null;
  for (const text of segments(hit)) {
    const at = fold(text).indexOf(needle);
    if (at < 0) continue;
    const end = at + needle.length;
    if (LEFT_AFTER_NAME.test(text.slice(end, end + 40))) return null;
    const roles = roleMentions(text, terms, ctx);
    if (roles.length === 0) {
      fallback ??= text.trim();
      continue;
    }
    const distance = (r: RoleMention) => (r.start >= end ? r.start - end : r.end <= at ? at - r.end : 0);
    const nearest = roles.reduce((best, r) => (distance(r) < distance(best) ? r : best));
    if (distance(nearest) <= PROXIMITY && nearest.otherOrg) return null;
    if (distance(nearest) <= PROXIMITY && !nearest.former) current ??= text.trim();
  }
  return current ?? fallback;
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
  const tally = new Map<string, { name: string; pages: SupportPage[]; hosts: Set<string> }>();
  for (const hit of hits) {
    if (seenUrls.has(hit.url) || !isUsableEvidence(hit, ctx)) continue;
    seenUrls.add(hit.url);
    for (const [key, { name, quote }] of namesInHit(hit, terms, blocked, ctx)) {
      const entry = tally.get(key) ?? { name, pages: [], hosts: new Set<string>() };
      entry.pages.push({ url: hit.url, title: hit.title, quote });
      entry.hosts.add(safeHost(hit.url));
      tally.set(key, entry);
    }
  }

  return [...tally.values()]
    .map(({ name, pages, hosts }) => {
      const support = summarizeSupport(pages, ctx.domain);
      const official = [...hosts].filter((h) => isOfficialHost(h, ctx.domain));
      return {
        name,
        sources: support.score,
        sites: support.sites,
        strongSites: support.strongSites,
        links: support.links.slice(0, MAX_LINKS),
        hosts: [...official, ...[...hosts].filter((h) => !official.includes(h))],
      };
    })
    .filter((e) => e.sources >= MIN_SOURCES && e.strongSites >= 1)
    .sort((a, b) => b.sources - a.sources)
    .slice(0, MAX_NAMES);
}

/** How much support this candidate has (0 if none). */
export function corroborationFor(candidateName: string, evidence: EvidenceName[]): number {
  return evidence.find((e) => namesMatch(e.name, candidateName))?.sources ?? 0;
}
