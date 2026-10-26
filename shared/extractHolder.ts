// Strategy S2: let Claude read the independent evidence (numbered search results, not LinkedIn)
// and say who holds the role *now*. Regex extraction (corroboration.ts) understands only simple
// phrasings; Claude also handles "Andy X, president and CEO", dated statements and successions.
//
// Safety: the reply is strict JSON validated with zod, and a name is accepted only if it appears
// literally in one of the cited results — the model can pick, but never invent, a person.

import { z } from 'zod';
import { evidenceRoleTerms, isOfficialHost } from './corroboration';
import type { LlmClient, RankingContext, SearchHit, SourceLink } from './types';

const MAX_EVIDENCE = 20;
const MAX_SNIPPET = 300;
const MAX_OUTPUT_TOKENS = 300;
const MAX_LINKS = 3;

export interface ExtractedHolder {
  name: string;
  /** Weighted support from the cited results (company's own domain counts double). */
  sources: number;
  links: SourceLink[];
}

const SYSTEM_PROMPT = `You read web search results (company websites, press releases, news; not LinkedIn) and say who CURRENTLY holds a position at a company.

Rules:
- Use only names that appear literally in the numbered results. Never use outside knowledge, never guess.
- "former", "ex-", "previously", "stepped down", "succeeded by", "until <year>", past tense: that person is NOT current.
- If results disagree, prefer the most recent dated statement and the company's own website.
- Equivalent titles count (e.g. CEO = Chief Executive Officer). Related but different titles do not (Founder is not CEO; VP Engineering is not CTO).
- sourceIds lists the numbers of the results that say this person holds the position now.
- If no result clearly names the current holder, return {"holder": null}.

Reply with JSON only, exactly in this shape:
{"holder":{"name":"...","isCurrent":true,"sourceIds":[1,2]}}`;

function host(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ');
}

export function buildExtractionPrompt(evidence: SearchHit[], ctx: RankingContext): { system: string; prompt: string } {
  const lines = evidence
    .slice(0, MAX_EVIDENCE)
    .map((hit, index) => `[${index + 1}] ${host(hit.url)} — ${hit.title.slice(0, 160)} — ${hit.snippet.slice(0, MAX_SNIPPET)}`);
  const prompt = [
    `Company: ${ctx.companyName}`,
    `Company website: ${ctx.domain}`,
    `Position: ${ctx.position}`,
    `Equivalent titles: ${evidenceRoleTerms(ctx.position, ctx.synonyms).slice(1).join(', ') || 'none'}`,
    '',
    'Results:',
    ...lines,
    '',
    'Return the JSON now.',
  ].join('\n');
  return { system: SYSTEM_PROMPT, prompt };
}

const ExtractionReply = z.object({
  holder: z
    .object({
      name: z.string().min(3).max(100),
      isCurrent: z.boolean(),
      sourceIds: z.array(z.number().int()).min(1).max(20),
    })
    .nullable(),
});

function jsonPart(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

/** Validates Claude's reply against the evidence it was given. Null = no usable holder. */
export function parseExtraction(text: string, evidence: SearchHit[], ctx: RankingContext): ExtractedHolder | null {
  const raw = jsonPart(text);
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = ExtractionReply.safeParse(data);
  if (!parsed.success || !parsed.data.holder || !parsed.data.holder.isCurrent) return null;
  const { name, sourceIds } = parsed.data.holder;

  const usable = evidence.slice(0, MAX_EVIDENCE);
  const cited = [...new Set(sourceIds)].filter((id) => id >= 1 && id <= usable.length).map((id) => usable[id - 1]!);
  // The name must literally appear in what it cites — the model may pick, never invent.
  const needle = fold(name.trim());
  const supporting = cited.filter((hit) => fold(`${hit.title} ${hit.snippet}`).includes(needle));
  if (supporting.length === 0) return null;

  const pages = [...new Map(supporting.map((hit) => [hit.url, hit])).values()].map((hit) => ({
    hit,
    official: isOfficialHost(host(hit.url), ctx.domain),
  }));
  pages.sort((a, b) => Number(b.official) - Number(a.official));
  return {
    name: name.trim(),
    sources: pages.reduce((sum, p) => sum + (p.official ? 2 : 1), 0),
    links: pages.slice(0, MAX_LINKS).map((p) => ({ title: p.hit.title.slice(0, 200), url: p.hit.url })),
  };
}

/** One short model call. Throws on model/network errors so the caller can fall back to regex. */
export async function extractHolderWithClaude(
  evidence: SearchHit[],
  ctx: RankingContext,
  client: LlmClient,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<ExtractedHolder | null> {
  if (evidence.length === 0) return null;
  const { system, prompt } = buildExtractionPrompt(evidence, ctx);
  const text = await client.complete({
    system,
    prompt,
    maxTokens: MAX_OUTPUT_TOKENS,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
  return parseExtraction(text, evidence, ctx);
}
