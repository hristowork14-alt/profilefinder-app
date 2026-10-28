// Strategy S5: the deterministic rule that decides what the user sees, applied in code after
// ranking (so it never depends on a model following instructions).
//
//  • A verified holder exists and a LinkedIn profile matches them → show only that profile
//    (marked verified). Profiles that merely claim the title are not shown.
//  • A verified holder exists but no profile matches → show the holder's name and sources, no
//    profiles (e.g. a CEO who has no public LinkedIn profile).
//  • A verified holder exists, but their profile disagrees: it names another current employer
//    ("Design at Quillstone"), or Claude read it and scored it below 50 (e.g. it shows they have
//    moved on) → show that profile unverified, with the reason, and no verified holder
//    ("contradicted").
//  • No verified holder → show only credible results (confidence ≥ 50), labelled unverified;
//    thin, possibly self-declared profiles are capped below that.

import { namesMatch } from './corroboration';
import { parseLinkedInTitle } from './heuristicRanker';
import { normalizePosition } from './positionSynonyms';
import { profileSignals } from './profileQuality';
import { mentionsCompany } from './sourceQuality';
import type { Candidate, RankedProfile, RankingContext, VerifiedHolder } from './types';

/**
 * How the answer was reached. Stored with each search (migrations 0004/0005), so keep this list
 * in sync with the CHECK constraints there.
 *  - verified_profile     sources name the holder and their profile matches
 *  - verified_elsewhere   … and the profile also lists another current employer (dual role)
 *  - verified_name_match  sources name the holder; the only profile with that exact name doesn't mention the company
 *  - verified_no_profile  sources name the holder; no public profile found
 *  - likely               only one strong source names the holder (never shown as verified)
 *  - contradicted         sources name someone, but their profile disagrees
 *  - unverified           no holder confirmed; credible profiles shown
 *  - closest              nothing matched the exact title; closest matches shown, clearly labelled
 *  - no_results           nothing credible found
 */
export const DECISIONS = [
  'verified_profile',
  'verified_elsewhere',
  'verified_name_match',
  'verified_no_profile',
  'likely',
  'contradicted',
  'unverified',
  'closest',
  'no_results',
] as const;
export type Decision = (typeof DECISIONS)[number];

export interface DecisionOptions {
  /** True when Claude ranked the candidates (it read each profile against the evidence). */
  rankerReadProfiles?: boolean;
}

export interface DecisionOutcome {
  results: RankedProfile[];
  verifiedHolder: VerifiedHolder | null;
  decision: Decision;
}

/** Shown only if confidence is at least this when nobody could be verified. */
export const MIN_UNVERIFIED_CONFIDENCE = 50;
/** Thin profiles (no audience, nothing listed) are capped here when nobody could be verified. */
const THIN_CAP = 45;
const MAX_VERIFIED_PROFILES = 2;
/** Most profiles shown for a role many people hold / one person holds. */
export const MAX_MANY_RESULTS = 25;
const MAX_SINGLE_RESULTS = 5;

function mentions(haystack: string, phrase: string): boolean {
  const p = normalizePosition(phrase);
  return p.length > 0 && ` ${normalizePosition(haystack)} `.includes(` ${p} `);
}

/** A profile found by name alone must mention the company to count as the verified person (the role alone fits namesakes elsewhere). */
function relatesToCompany(candidate: Candidate, ctx: RankingContext): boolean {
  const text = `${candidate.title} ${candidate.snippet}`;
  const label = ctx.domain.split('.')[0] ?? ctx.domain;
  return [ctx.companyName, label, ctx.domain].some((term) => mentions(text, term)) || mentionsCompany(text, ctx);
}

/** Highest confidence a conflicting profile is shown with. */
const CONFLICT_CAP = 60;
const EMPLOYER_AT = /(?:^|[\s,(])(?:at|@)\s+([^|·,;()–—]+?)(?=\s*(?:$|[|·,;()–—]|\s-\s|\sand\s))/gi;
const EXPERIENCE = /\bExperience:\s*([^·|]+)/gi;

/** Employers a LinkedIn search result states: "Design at Quillstone", "CTO @ Kelvin", "Experience: Quillstone". */
export function statedEmployers(candidate: Pick<Candidate, 'title' | 'snippet'>): string[] {
  const { headline } = parseLinkedInTitle(candidate.title);
  const found = [...headline.matchAll(EMPLOYER_AT), ...candidate.snippet.matchAll(EXPERIENCE)].map((m) => (m[1] ?? '').trim());
  return found.filter((e) => e.length >= 2);
}

/** The other employer the profile names, when it names employers and none of them is this company. */
export function otherEmployer(candidate: Pick<Candidate, 'title' | 'snippet'>, ctx: RankingContext): string | null {
  const employers = statedEmployers(candidate);
  if (employers.length === 0) return null;
  const isThis = (org: string) => {
    const key = normalizePosition(org);
    return mentionsCompany(org, ctx) || (key.length >= 3 && ` ${normalizePosition(ctx.companyName)} `.includes(` ${key} `));
  };
  return employers.some(isThis) ? null : (employers[0] ?? null);
}

/** Where the profile text mentions this company (name, website, website name or one of its other names). */
function companyMentionIndexes(text: string, ctx: RankingContext): { start: number; end: number }[] {
  const label = ctx.domain.split('.')[0] ?? '';
  const names = [ctx.companyName, ...(ctx.aliases ?? []), ctx.domain, label].filter((n) => n.trim().length >= 3);
  const lower = text.toLowerCase();
  const found: { start: number; end: number }[] = [];
  for (const name of names) {
    const needle = name.toLowerCase();
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
      const before = lower[at - 1] ?? ' ';
      const after = lower[at + needle.length] ?? ' ';
      if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) found.push({ start: at, end: at + needle.length });
    }
  }
  return found;
}

const PAST_BEFORE_COMPANY = /(?:\bex|\bformer(?:ly)?|\bprevious(?:ly)?|\bpast|\balumn\w*|\bwas)[\s-]+(?:\S+\s+){0,2}$/i;
const PAST_AFTER_COMPANY = /^[\s,)]{0,3}\(?\s*(?:19|20)\d\d\s*[-–]\s*(?:19|20)\d\d\b/;

/** True when the profile mentions this company at least once without marking it as past ("ex-", "former", "2019–2023"). */
function mentionsCompanyCurrently(candidate: Candidate, ctx: RankingContext): boolean {
  const text = `${candidate.title} ${candidate.snippet}`;
  return companyMentionIndexes(text, ctx).some(
    ({ start, end }) =>
      !PAST_BEFORE_COMPANY.test(text.slice(Math.max(0, start - 40), start)) && !PAST_AFTER_COMPANY.test(text.slice(end, end + 20)),
  );
}

/** Highest confidence a person named by only one source is shown with (below "verified" levels). */
const LIKELY_CAP = 70;
/** Confidence of the only exact-name profile of a verified person whose profile doesn't mention the company. */
const NAME_MATCH_CONFIDENCE = 60;

export interface DecisionOptionsFull extends DecisionOptions {
  /** Role many people hold: no single holder, thin short profiles are normal (no cap). */
  manyHolders?: boolean;
  /** The holder is named by only one strong source: show, never mark verified. */
  likely?: boolean;
  /** The only LinkedIn profile with the holder's exact name, which doesn't mention the company (see pipeline.ts). */
  nameOnlyProfile?: Candidate;
}

export function decideResults(
  ranked: RankedProfile[],
  candidates: Candidate[],
  holder: VerifiedHolder | null,
  ctx: RankingContext,
  options: DecisionOptionsFull = {},
): DecisionOutcome {
  if (holder) {
    const likely = Boolean(options.likely);
    const found = candidates
      // Google matched the company on the page when it answered "<name>" "<company>", so a bare
      // snippet is fine then; otherwise the snippet itself must mention the company.
      .filter((c) => namesMatch(holder.name, parseLinkedInTitle(c.title).name) && (c.foundWithCompany || relatesToCompany(c, ctx)))
      .slice(0, MAX_VERIFIED_PROFILES);

    if (found.length === 0) {
      const only = options.nameOnlyProfile;
      if (only) {
        const parsed = parseLinkedInTitle(only.title);
        return {
          results: [
            {
              fullName: parsed.name,
              headline: parsed.headline,
              linkedinUrl: only.linkedinUrl,
              confidence: NAME_MATCH_CONFIDENCE,
              reasoning: `Sources name ${holder.name} as ${holder.role ?? ctx.position} at ${ctx.companyName}. This is the only LinkedIn profile with this exact name, but it doesn't mention ${ctx.companyName} — check it before using.`,
              verified: false,
            },
          ],
          verifiedHolder: holder,
          decision: likely ? 'likely' : 'verified_name_match',
        };
      }
      return { results: [], verifiedHolder: holder, decision: likely ? 'likely' : 'verified_no_profile' };
    }

    /** Another employer, and this company only as a past job (or not at all): the profile disagrees. */
    const conflicting = (c: Candidate) => otherEmployer(c, ctx) !== null && !mentionsCompanyCurrently(c, ctx);
    const doubted = (c: Candidate) => {
      if (conflicting(c)) return true;
      const score = ranked.find((r) => r.linkedinUrl === c.linkedinUrl)?.confidence;
      return Boolean(options.rankerReadProfiles) && score !== undefined && score < MIN_UNVERIFIED_CONFIDENCE;
    };
    const matching = found.filter((c) => !doubted(c));
    if (matching.length === 0) {
      const results = found
        .map((candidate): RankedProfile => {
          const fromRanker = ranked.find((r) => r.linkedinUrl === candidate.linkedinUrl);
          const parsed = parseLinkedInTitle(candidate.title);
          const employer = otherEmployer(candidate, ctx);
          return {
            fullName: fromRanker?.fullName ?? parsed.name,
            headline: fromRanker?.headline ?? parsed.headline,
            linkedinUrl: candidate.linkedinUrl,
            confidence: Math.min(fromRanker?.confidence ?? 40, CONFLICT_CAP),
            reasoning: employer
              ? `Sources name ${holder.name} as ${holder.role ?? ctx.position} at ${ctx.companyName}, but this LinkedIn profile shows ${employer} — it may be out of date, or a different person.`
              : (fromRanker?.reasoning ?? `Sources name ${holder.name}, but this LinkedIn profile does not clearly match.`),
            verified: false,
          };
        })
        .sort((a, b) => b.confidence - a.confidence);
      return { results, verifiedHolder: null, decision: 'contradicted' };
    }

    const floor = Math.min(98, 70 + 5 * holder.sources);
    const results = matching
      .map((candidate): RankedProfile => {
        const fromRanker = ranked.find((r) => r.linkedinUrl === candidate.linkedinUrl);
        const parsed = parseLinkedInTitle(candidate.title);
        const elsewhere = otherEmployer(candidate, ctx);
        const reasoning =
          fromRanker?.reasoning ??
          (likely
            ? `Named as ${holder.role ?? ctx.position} at ${ctx.companyName} by one independent source.`
            : `Named as ${holder.role ?? ctx.position} at ${ctx.companyName} by ${holder.sources} independent sources.`);
        return {
          fullName: fromRanker?.fullName ?? parsed.name,
          headline: fromRanker?.headline ?? parsed.headline,
          linkedinUrl: candidate.linkedinUrl,
          confidence: likely ? Math.min(fromRanker?.confidence ?? LIKELY_CAP, LIKELY_CAP) : Math.max(fromRanker?.confidence ?? 0, floor),
          reasoning: elsewhere && !likely ? `${reasoning} The profile also lists ${elsewhere}.` : reasoning,
          verified: !likely,
        };
      })
      .sort((a, b) => b.confidence - a.confidence);
    const dual = !likely && matching.some((c) => otherEmployer(c, ctx) !== null);
    return { results, verifiedHolder: holder, decision: likely ? 'likely' : dual ? 'verified_elsewhere' : 'verified_profile' };
  }

  const byUrl = new Map(candidates.map((c) => [c.linkedinUrl, c]));
  const results = ranked
    .map((r): RankedProfile => {
      const candidate = byUrl.get(r.linkedinUrl);
      // Thin, possibly self-declared profiles matter for roles one person holds (a fake "CEO of
      // Amazon"); for roles many people hold, a short headline is normal.
      const thin = !options.manyHolders && candidate ? profileSignals(candidate).thin : false;
      return { ...r, confidence: thin ? Math.min(r.confidence, THIN_CAP) : r.confidence, verified: false };
    })
    .filter((r) => r.confidence >= MIN_UNVERIFIED_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, options.manyHolders ? MAX_MANY_RESULTS : MAX_SINGLE_RESULTS);
  return { results, verifiedHolder: null, decision: results.length > 0 ? 'unverified' : 'no_results' };
}

/** Words that say nothing about what a role does. */
const NOT_CORE = new Set([
  'of',
  'and',
  'the',
  'at',
  'for',
  'to',
  'in',
  'senior',
  'sr',
  'junior',
  'jr',
  'lead',
  'principal',
  'staff',
  'associate',
  'head',
  'chief',
]);
const CLOSEST_LIMIT = 10;
/** Closest matches are always shown below the credible line. */
const CLOSEST_CAP = 45;

/**
 * When nothing matched the exact title: people at the company whose headline shares a core word
 * of it (or of a variant) — "Powertrain Engineer" for "Mechanical Engineer". Clearly labelled,
 * never verified, always below the credible line. Former roles are left out.
 */
export function closestMatches(candidates: Candidate[], ctx: RankingContext, limit = CLOSEST_LIMIT): RankedProfile[] {
  const core = new Set(
    [ctx.position, ...(ctx.variants ?? [])]
      .flatMap((t) => normalizePosition(t).split(' '))
      .filter((w) => w.length >= 3 && !NOT_CORE.has(w)),
  );
  if (core.size === 0) return [];
  const scored: RankedProfile[] = [];
  for (const candidate of candidates) {
    const { name, headline } = parseLinkedInTitle(candidate.title);
    if (!name || !mentionsCompanyCurrently(candidate, ctx)) continue;
    const words = new Set(normalizePosition(headline).split(' '));
    const shared = [...core].filter((w) => words.has(w)).length;
    if (shared === 0) continue;
    scored.push({
      fullName: name,
      headline,
      linkedinUrl: candidate.linkedinUrl,
      confidence: Math.min(CLOSEST_CAP, 25 + 10 * shared),
      reasoning: `Closest match: ${headline || 'profile'} at ${ctx.companyName} — no exact “${ctx.position}” found.`,
      verified: false,
    });
  }
  return scored.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}
