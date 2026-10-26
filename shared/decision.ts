// Strategy S5: the deterministic rule that decides what the user sees, applied in code after
// ranking (so it never depends on a model following instructions).
//
//  • A verified holder exists and a LinkedIn profile matches them → show only that profile
//    (marked verified). Profiles that merely claim the title are not shown.
//  • A verified holder exists but no profile matches → show the holder's name and sources, no
//    profiles (e.g. a CEO who has no public LinkedIn profile).
//  • A verified holder exists, but Claude read their profile and scored it below 50 (e.g. it shows
//    they have moved on) → the sources and the profile disagree: show that profile unverified, with
//    Claude's own score and reasoning, and no verified holder.
//  • No verified holder → show only credible results (confidence ≥ 50), labelled unverified;
//    thin, possibly self-declared profiles are capped below that.

import { namesMatch } from './corroboration';
import { parseLinkedInTitle } from './heuristicRanker';
import { normalizePosition } from './positionSynonyms';
import { profileSignals } from './profileQuality';
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

/** A namesake must at least mention the company or the role to count as the verified person. */
function relatesToRole(candidate: Candidate, ctx: RankingContext): boolean {
  const text = `${candidate.title} ${candidate.snippet}`;
  const label = ctx.domain.split('.')[0] ?? ctx.domain;
  return [ctx.companyName, label, ctx.domain, ctx.position, ...ctx.synonyms].some((term) => mentions(text, term));
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
      .filter((c) => namesMatch(holder.name, parseLinkedInTitle(c.title).name) && (c.foundWithCompany || relatesToRole(c, ctx)))
      .slice(0, MAX_VERIFIED_PROFILES);
    if (found.length === 0) return { results: [], verifiedHolder: holder, decision: 'verified_no_profile' };

    const doubted = (c: Candidate) => {
      const score = ranked.find((r) => r.linkedinUrl === c.linkedinUrl)?.confidence;
      return Boolean(options.rankerReadProfiles) && score !== undefined && score < MIN_UNVERIFIED_CONFIDENCE;
    };
    const matching = found.filter((c) => !doubted(c));
    if (matching.length === 0) {
      const results = ranked
        .filter((r) => found.some((c) => c.linkedinUrl === r.linkedinUrl))
        .map((r): RankedProfile => ({ ...r, verified: false }))
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
