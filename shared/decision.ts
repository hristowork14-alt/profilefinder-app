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

export type Decision = 'verified_profile' | 'verified_no_profile' | 'contradicted' | 'unverified' | 'no_results';

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

export function decideResults(
  ranked: RankedProfile[],
  candidates: Candidate[],
  holder: VerifiedHolder | null,
  ctx: RankingContext,
  options: DecisionOptions = {},
): DecisionOutcome {
  if (holder) {
    const found = candidates
      // Google matched the company on the page when it answered "<name>" "<company>", so a bare
      // snippet is fine then; otherwise the snippet itself must mention the company or the role.
      .filter((c) => namesMatch(holder.name, parseLinkedInTitle(c.title).name) && (c.foundWithCompany || relatesToCompany(c, ctx)))
      .slice(0, MAX_VERIFIED_PROFILES);
    if (found.length === 0) return { results: [], verifiedHolder: holder, decision: 'verified_no_profile' };

    const doubted = (c: Candidate) => {
      if (otherEmployer(c, ctx)) return true;
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
              ? `Sources name ${holder.name} as ${ctx.position} at ${ctx.companyName}, but this LinkedIn profile shows ${employer} — it may be out of date, or a different person.`
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
        return {
          fullName: fromRanker?.fullName ?? parsed.name,
          headline: fromRanker?.headline ?? parsed.headline,
          linkedinUrl: candidate.linkedinUrl,
          confidence: Math.max(fromRanker?.confidence ?? 0, floor),
          reasoning: fromRanker?.reasoning ?? `Named as ${ctx.position} at ${ctx.companyName} by ${holder.sources} independent sources.`,
          verified: true,
        };
      })
      .sort((a, b) => b.confidence - a.confidence);
    return { results, verifiedHolder: holder, decision: 'verified_profile' };
  }

  const byUrl = new Map(candidates.map((c) => [c.linkedinUrl, c]));
  const results = ranked
    .map((r): RankedProfile => {
      const candidate = byUrl.get(r.linkedinUrl);
      const thin = candidate ? profileSignals(candidate).thin : false;
      return { ...r, confidence: thin ? Math.min(r.confidence, THIN_CAP) : r.confidence, verified: false };
    })
    .filter((r) => r.confidence >= MIN_UNVERIFIED_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence);
  return { results, verifiedHolder: null, decision: results.length > 0 ? 'unverified' : 'no_results' };
}
