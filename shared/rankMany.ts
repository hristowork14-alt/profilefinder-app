// Ranking for roles many people hold at once (Mechanical Engineer, Developer, Recruiter …), real
// app only. Up to 25 people instead of 5, so the reply is compact: Claude answers with candidate
// numbers, confidence and a few words of reason; names, headlines and URLs come from the search
// results themselves — the model can't invent a URL even if it tried.

import { z } from 'zod';
import { parseLinkedInTitle } from './heuristicRanker';
import { RankingError } from './rankWithClaude';
import type { Candidate, LlmClient, RankedProfile, RankingContext } from './types';

const MAX_CANDIDATES = 40;
const MAX_SNIPPET = 200;
const MAX_OUTPUT_TOKENS = 1400;

const SYSTEM_PROMPT = `You match people to a job role at a company using web search results about public LinkedIn profiles.

Many people hold this role at the company at once, so rank everyone who fits — not just one person.

Rules:
- Include people who currently work at the company — or under one of the company's own names listed — in the role, an equivalent title, a listed variant (including translations) or a closely related specialisation.
- A name that starts with the company name ("<Company> <Something>") is usually the same company group: accept it unless the text shows a different business.
- Short headlines are normal for engineers and staff: do not lower confidence just because a profile shows little.
- Strongly penalize people who used to work there ("ex-", "former", "previously", past tense, dates that ended) and people at an unrelated company with a similar name.
- confidence is an integer 0-100; leave out anyone below 20. reason is at most 12 words.
- Refer to candidates by their id only.

Reply with JSON only, exactly in this shape:
{"results":[{"id":1,"confidence":80,"reason":"..."}]}`;

export function buildManyRankingPrompt(candidates: Candidate[], ctx: RankingContext): { system: string; prompt: string } {
  const list = candidates.slice(0, MAX_CANDIDATES).map((c, index) => ({
    id: index + 1,
    title: c.title.slice(0, 200),
    snippet: c.snippet.slice(0, MAX_SNIPPET),
  }));
  const prompt = [
    `Company name: ${ctx.companyName}`,
    `Company website: ${ctx.domain}`,
    `Other names the company uses: ${ctx.aliases?.length ? ctx.aliases.join(', ') : 'none'}`,
    `Position: ${ctx.position}`,
    `Equivalent titles: ${ctx.synonyms.length ? ctx.synonyms.join(', ') : 'none'}`,
    `Variants and translations of the title: ${ctx.variants?.length ? ctx.variants.join(', ') : 'none'}`,
    '',
    'Candidates (from web search results):',
    JSON.stringify(list, null, 1),
    '',
    'Return the JSON now.',
  ].join('\n');
  return { system: SYSTEM_PROMPT, prompt };
}

const Reply = z.object({
  results: z
    .array(
      z.object({
        id: z.number().int(),
        confidence: z.number().min(0).max(100),
        reason: z.string().max(300).default(''),
      }),
    )
    .max(60),
});

export type ManyParseResult = { ok: true; results: RankedProfile[] } | { ok: false; error: string };

export function parseManyRanking(text: string, candidates: Candidate[], maxResults: number): ManyParseResult {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, error: 'No JSON object found' };
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ok: false, error: 'Response was not valid JSON' };
  }
  const parsed = Reply.safeParse(data);
  if (!parsed.success) return { ok: false, error: 'Response did not match the schema' };

  const usable = candidates.slice(0, MAX_CANDIDATES);
  const seen = new Set<number>();
  const results: RankedProfile[] = [];
  for (const item of parsed.data.results) {
    const candidate = usable[item.id - 1];
    if (!candidate || seen.has(item.id)) continue; // unknown or duplicate id → dropped
    seen.add(item.id);
    const { name, headline } = parseLinkedInTitle(candidate.title);
    if (!name) continue;
    results.push({
      fullName: name,
      headline,
      linkedinUrl: candidate.linkedinUrl,
      confidence: Math.round(item.confidence),
      reasoning: item.reason.trim().slice(0, 300),
    });
  }
  results.sort((a, b) => b.confidence - a.confidence);
  return { ok: true, results: results.slice(0, maxResults) };
}

/** One model call. Throws (RankingError or the model's error) so the caller can use the heuristic instead. */
export async function rankManyWithClaude(
  candidates: Candidate[],
  ctx: RankingContext,
  client: LlmClient,
  options: { timeoutMs: number; maxResults: number; signal?: AbortSignal },
): Promise<RankedProfile[]> {
  if (candidates.length === 0) return [];
  const { system, prompt } = buildManyRankingPrompt(candidates, ctx);
  const text = await client.complete({
    system,
    prompt,
    maxTokens: MAX_OUTPUT_TOKENS,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
  const parsed = parseManyRanking(text, candidates, options.maxResults);
  if (!parsed.ok) throw new RankingError(`Claude ranking failed: ${parsed.error}`);
  return parsed.results;
}
