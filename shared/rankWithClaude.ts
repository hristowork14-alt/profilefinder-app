// Asks Claude to pick and rank the best candidates, as strict JSON.
// The LlmClient is either the real Anthropic client (netlify/functions/_lib/anthropicClient.ts)
// or the fixture-based mock (shared/mocks/mockLlmClient.ts) — same code path either way.

import { profileSignals } from './profileQuality';
import { parseRankingResponse } from './rankingSchema';
import type { Candidate, LlmClient, RankedProfile, RankingContext } from './types';

export class RankingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RankingError';
  }
}

const MAX_CANDIDATES = 25;
const MAX_SNIPPET = 280;
const MAX_OUTPUT_TOKENS = 900;

export const CANDIDATES_OPEN = '<candidates>';
export const CANDIDATES_CLOSE = '</candidates>';

const SYSTEM_PROMPT = `You match people to job roles using web search results about public LinkedIn profiles.

Rules:
- Only use LinkedIn URLs from the provided candidate list. Copy them exactly. Never invent, guess or modify a URL.
- Pick people who currently hold the requested position (or an equivalent title) at the requested company.
- Strongly penalize people who used to work there: "ex-", "former", "previously", past tense, or dates that ended.
- Strongly penalize people at a different company with a similar name.
- Prefer an empty list over guessing. Include at most 5 people. Leave out anyone below 20 confidence.
- confidence is an integer 0-100. reasoning is one short sentence.

Reply with JSON only, no prose, exactly in this shape:
{"results":[{"fullName":"...","headline":"...","linkedinUrl":"...","confidence":0,"reasoning":"..."}]}`;

/** Only added when corroboration ran (real app), so demo prompts are unchanged. */
function evidenceSection(ctx: RankingContext): string[] {
  if (!ctx.evidence) return [];
  const named = ctx.evidence.map((e) => `${e.name} (${e.sources} sources)`).join(', ');
  return [
    '',
    `Independent web sources (company sites, press, news — not LinkedIn) that name who holds this position: ${named || 'none found'}`,
    'Anyone can type any title into their own LinkedIn headline, so a headline alone proves little.',
    '- If independent sources name someone, the matching candidate (namedByIndependentSources > 0) is very likely the real holder: rank them first. Give a candidate who only claims the title while the sources name someone else at most 40 confidence.',
    '- If they name nobody, judge from the profile text, and be cautious with thin profiles (no location, no other experience, few followers or connections) at large companies: at most 60 confidence.',
    '- profileSignals summarizes what the search result shows about each profile (audience, location, experience). Use it only to break ties or downgrade, never as proof.',
  ];
}

export function buildRankingPrompt(candidates: Candidate[], ctx: RankingContext): { system: string; prompt: string } {
  const list = candidates.slice(0, MAX_CANDIDATES).map((c, index) => ({
    id: index + 1,
    title: c.title.slice(0, 200),
    snippet: c.snippet.slice(0, MAX_SNIPPET),
    linkedinUrl: c.linkedinUrl,
    ...(c.corroboratedBy !== undefined ? { namedByIndependentSources: c.corroboratedBy } : {}),
    // Only when verification ran (real app), so demo prompts are unchanged.
    ...(ctx.evidence !== undefined ? { profileSignals: profileSignals(c).summary } : {}),
  }));

  const prompt = [
    `Company name: ${ctx.companyName}`,
    `Company website: ${ctx.domain}`,
    `Position: ${ctx.position}`,
    ctx.synonyms.length ? `Equivalent titles: ${ctx.synonyms.join(', ')}` : 'Equivalent titles: none',
    ...evidenceSection(ctx),
    '',
    'Candidates (from web search results):',
    CANDIDATES_OPEN,
    JSON.stringify(list, null, 1),
    CANDIDATES_CLOSE,
    '',
    'Return the JSON now.',
  ].join('\n');

  return { system: SYSTEM_PROMPT, prompt };
}

export interface RankOptions {
  /** Time allowed for each model call. */
  timeoutMs: number;
  /** Whether a second attempt fits in the remaining time budget. */
  allowRetry: boolean | (() => boolean);
  signal?: AbortSignal;
}

export async function rankWithClaude(
  candidates: Candidate[],
  ctx: RankingContext,
  client: LlmClient,
  options: RankOptions,
): Promise<RankedProfile[]> {
  if (candidates.length === 0) return [];
  const { system, prompt } = buildRankingPrompt(candidates, ctx);
  const canRetry = () => (typeof options.allowRetry === 'function' ? options.allowRetry() : options.allowRetry);

  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2 && !canRetry()) break;
    const text = await client.complete({
      system,
      prompt:
        attempt === 1 ? prompt : `${prompt}\n\nYour previous reply could not be parsed (${lastError}). Reply with the JSON object only.`,
      maxTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    const parsed = parseRankingResponse(text, candidates);
    if (parsed.ok) return parsed.results;
    lastError = parsed.error;
  }
  throw new RankingError(`Claude ranking failed: ${lastError}`);
}
