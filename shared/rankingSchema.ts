// Validates Claude's ranking response with zod and enforces "never invent URLs":
// every URL must match one of the candidates we actually got from the search API.

import { z } from 'zod';
import { normalizeLinkedInProfileUrl } from './linkedinUrl';
import type { Candidate, RankedProfile } from './types';

export const RankedItemSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  headline: z.string().trim().max(300).default(''),
  linkedinUrl: z.string().trim().min(1).max(2048),
  confidence: z.number().min(0).max(100),
  reasoning: z.string().trim().max(500).default(''),
});

export const RankingResponseSchema = z.object({
  results: z.array(RankedItemSchema).max(5),
});

export type RankingParseResult = { ok: true; results: RankedProfile[] } | { ok: false; error: string };

/** Pulls the JSON object out of a reply that may include a code fence or a sentence around it. */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object found');
  return JSON.parse(candidate.slice(start, end + 1));
}

export function parseRankingResponse(text: string, candidates: Candidate[]): RankingParseResult {
  let json: unknown;
  try {
    json = extractJson(text);
  } catch {
    return { ok: false, error: 'Response was not valid JSON' };
  }

  const parsed = RankingResponseSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `Response did not match the schema${first ? ` (${first.path.join('.')}: ${first.message})` : ''}` };
  }

  const allowed = new Map(candidates.map((c) => [c.slug, c.linkedinUrl]));
  const seen = new Set<string>();
  const results: RankedProfile[] = [];
  for (const item of parsed.data.results) {
    const normalized = normalizeLinkedInProfileUrl(item.linkedinUrl);
    const url = normalized ? allowed.get(normalized.slug) : undefined;
    if (!normalized || !url || seen.has(normalized.slug)) continue; // invented or duplicate URL → dropped
    seen.add(normalized.slug);
    results.push({
      fullName: item.fullName,
      headline: item.headline,
      linkedinUrl: url,
      confidence: Math.round(item.confidence),
      reasoning: item.reasoning,
    });
  }

  results.sort((a, b) => b.confidence - a.confidence);
  return { ok: true, results: results.slice(0, 5) };
}
