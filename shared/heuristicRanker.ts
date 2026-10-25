// Deterministic ranker used when Claude is not configured, fails or runs out of time.
// Scores each candidate on company-name match + position/synonym match, minus a penalty
// for people who clearly used to work there.

import { normalizePosition } from './positionSynonyms';
import type { Candidate, RankedProfile, RankingContext } from './types';

const MAX_RESULTS = 5;
const MIN_CONFIDENCE = 30;
const FORMER_WORDS = '(?:ex|former|formerly|previously|past|retired)';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when the text says the person used to hold this role or work at this company,
 * e.g. "Ex-CFO at Stripe", "Former CFO at Stripe (2016–2020)". A plain "Previously at
 * Other Co" does not count, because it is about a different employer.
 */
export function mentionsFormerRole(text: string, ctx: RankingContext): boolean {
  const normalized = normalizePosition(text);
  const terms = [ctx.position, ...ctx.synonyms, ctx.companyName].map(normalizePosition).filter(Boolean);
  return terms.some((term) => new RegExp(`\\b${FORMER_WORDS}\\s+(?:\\S+\\s+){0,3}?${escapeRegExp(term)}\\b`, 'u').test(normalized));
}

/** Google shows LinkedIn titles as "Name - Headline | LinkedIn". */
export function parseLinkedInTitle(title: string): { name: string; headline: string } {
  const withoutSuffix = title
    .replace(/\s*[|–—-]\s*LinkedIn\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = withoutSuffix.split(/\s+[-–—|]\s+/);
  const name = (parts.shift() ?? '').trim();
  return { name, headline: parts.join(' - ').trim() };
}

function includesPhrase(haystack: string, phrase: string): boolean {
  const h = ` ${normalizePosition(haystack)} `;
  const p = normalizePosition(phrase);
  return p.length > 0 && h.includes(` ${p} `);
}

const JUNIOR_TO_ROLE = /\b(?:deputy|assistant|associate|interim|acting|vice)\b/i;
const LOOKALIKE_SUFFIX = '(?:group|holdings?|capital|ventures|partners|foundation|bank|studios?|consulting|international)';

/** "Stripe Group" / "Stripe Holdings" — a different company with a similar name. */
function looksLikeOtherCompany(text: string, companyName: string): boolean {
  const company = normalizePosition(companyName);
  if (!company || new RegExp(`\\b${LOOKALIKE_SUFFIX}\\b`, 'u').test(company)) return false;
  return new RegExp(`\\b${escapeRegExp(company)}\\s+${LOOKALIKE_SUFFIX}\\b`, 'u').test(normalizePosition(text));
}

/** Drops phrases that mention the role without the person holding it ("reports to the CFO"). */
function stripIndirectMentions(text: string): string {
  return text.replace(/\b(?:reports? to|reporting to|working with|supporting|assistant to)\s+(?:the\s+|our\s+)?[^.;,]*/gi, ' ');
}

export function rankHeuristically(candidates: Candidate[], ctx: RankingContext): RankedProfile[] {
  const domainLabel = ctx.domain.split('.')[0] ?? ctx.domain;
  const scored: RankedProfile[] = [];

  for (const original of candidates) {
    const candidate = { ...original, snippet: stripIndirectMentions(original.snippet) };
    const { name, headline } = parseLinkedInTitle(candidate.title);
    if (!name) continue;
    const text = `${candidate.title} ${candidate.snippet}`;

    const companyInTitle = includesPhrase(candidate.title, ctx.companyName) || includesPhrase(candidate.title, domainLabel);
    const companyAnywhere = companyInTitle || includesPhrase(text, ctx.companyName) || includesPhrase(text, ctx.domain);
    if (!companyAnywhere) continue;

    const exactInTitle = includesPhrase(headline, ctx.position);
    const synonymInTitle = ctx.synonyms.find((s) => includesPhrase(headline, s));
    const exactInSnippet = includesPhrase(candidate.snippet, ctx.position);
    const synonymInSnippet = ctx.synonyms.find((s) => includesPhrase(candidate.snippet, s));
    if (!exactInTitle && !synonymInTitle && !exactInSnippet && !synonymInSnippet) continue;

    let score = companyInTitle ? 40 : 25;
    if (exactInTitle) score += 45;
    else if (synonymInTitle) score += 32;
    else if (exactInSnippet) score += 20;
    else score += 14;

    const former = mentionsFormerRole(headline, ctx) || mentionsFormerRole(candidate.snippet, ctx);
    if (former) score -= 45;
    const junior = JUNIOR_TO_ROLE.test(headline);
    if (junior) score -= 22;
    const lookalike = looksLikeOtherCompany(text, ctx.companyName);
    if (lookalike) score -= 40;

    const confidence = Math.max(0, Math.min(100, Math.round(score)));
    if (confidence < MIN_CONFIDENCE && !former) continue;
    if (confidence < 10) continue;

    const matched = exactInTitle || exactInSnippet ? ctx.position : (synonymInTitle ?? synonymInSnippet ?? ctx.position);
    const reasoning = former
      ? `Mentions ${matched} at ${ctx.companyName}, but looks like a former role.`
      : lookalike
        ? `Mentions ${matched}, but possibly at a different company with a similar name.`
        : junior
          ? `Related title (${headline.split(' - ')[0] ?? matched}) at ${ctx.companyName}, not necessarily the main ${ctx.position}.`
          : `${exactInTitle || synonymInTitle ? 'Headline' : 'Search snippet'} mentions ${matched} at ${ctx.companyName}.`;

    scored.push({ fullName: name, headline, linkedinUrl: candidate.linkedinUrl, confidence, reasoning });
  }

  return scored.sort((a, b) => b.confidence - a.confidence).slice(0, MAX_RESULTS);
}
