// Fixture "Claude". Implements the same LlmClient interface as the real Anthropic client,
// reads the real ranking prompt, and answers with Claude-style JSON text — so the demo goes
// through exactly the same parsing, zod validation and URL whitelist as production.

import { sleep } from '../deadline';
import { mentionsFormerRole, parseLinkedInTitle } from '../heuristicRanker';
import { normalizePosition } from '../positionSynonyms';
import { CANDIDATES_CLOSE, CANDIDATES_OPEN } from '../rankWithClaude';
import type { LlmClient, RankedProfile, RankingContext } from '../types';
import { FLAKY_DOMAIN } from './fixtures';
import { between, createRandom } from './random';
import type { MockOptions } from './mockSearchProvider';

interface PromptCandidate {
  title: string;
  snippet: string;
  linkedinUrl: string;
}

function field(prompt: string, label: string): string {
  return prompt.match(new RegExp(`^${label}: (.*)$`, 'm'))?.[1]?.trim() ?? '';
}

function readPrompt(prompt: string): { ctx: RankingContext; candidates: PromptCandidate[] } {
  const synonymsLine = field(prompt, 'Equivalent titles');
  const ctx: RankingContext = {
    companyName: field(prompt, 'Company name'),
    domain: field(prompt, 'Company website'),
    position: field(prompt, 'Position'),
    synonyms: synonymsLine && synonymsLine !== 'none' ? synonymsLine.split(',').map((s) => s.trim()) : [],
  };
  const start = prompt.indexOf(CANDIDATES_OPEN);
  const end = prompt.indexOf(CANDIDATES_CLOSE);
  let candidates: PromptCandidate[] = [];
  if (start !== -1 && end > start) {
    try {
      candidates = JSON.parse(prompt.slice(start + CANDIDATES_OPEN.length, end)) as PromptCandidate[];
    } catch {
      candidates = [];
    }
  }
  return { ctx, candidates };
}

const has = (text: string, phrase: string) => {
  const p = normalizePosition(phrase);
  return p.length > 0 && ` ${normalizePosition(text)} `.includes(` ${p} `);
};

function judge(candidates: PromptCandidate[], ctx: RankingContext): RankedProfile[] {
  const results: RankedProfile[] = [];
  for (const c of candidates) {
    const { name, headline } = parseLinkedInTitle(c.title);
    if (!name) continue;
    const random = createRandom(c.linkedinUrl);
    const text = `${c.title} ${c.snippet}`;
    const company = ctx.companyName;

    const lookalike =
      new RegExp(`${company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+Group`, 'i').test(text) || /group holdings/i.test(text);
    if (lookalike) continue; // a different company with a similar name
    if (!has(text, company) && !has(text, ctx.domain)) continue;

    const exact = has(headline, ctx.position);
    const synonym = ctx.synonyms.find((s) => has(headline, s));
    const deputy = /\b(deputy|assistant|associate|interim|acting)\b/i.test(headline);
    const former = mentionsFormerRole(text, ctx);

    if (former && (has(c.snippet, ctx.position) || ctx.synonyms.some((s) => has(c.snippet, s)))) {
      results.push({
        fullName: name,
        headline,
        linkedinUrl: c.linkedinUrl,
        confidence: between(random, 21, 28),
        reasoning: `Held the ${ctx.position} role at ${company} in the past and now works elsewhere.`,
      });
    } else if ((exact || synonym) && deputy) {
      results.push({
        fullName: name,
        headline,
        linkedinUrl: c.linkedinUrl,
        confidence: between(random, 52, 60),
        reasoning: `Deputy-level title at ${company}; related, but probably not the main ${ctx.position}.`,
      });
    } else if (exact) {
      results.push({
        fullName: name,
        headline,
        linkedinUrl: c.linkedinUrl,
        confidence: between(random, 86, 95),
        reasoning: `Current ${ctx.position} at ${company}; the headline names both the role and the company.`,
      });
    } else if (synonym) {
      results.push({
        fullName: name,
        headline,
        linkedinUrl: c.linkedinUrl,
        confidence: between(random, 70, 80),
        reasoning: `"${synonym}" is an equivalent title to ${ctx.position}, held currently at ${company}.`,
      });
    }
  }
  return results.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

export function createMockLlmClient(options: MockOptions = {}): LlmClient {
  const scale = options.latencyScale ?? 1;
  return {
    async complete({ prompt, signal }) {
      const { ctx, candidates } = readPrompt(prompt);
      const random = createRandom(prompt);
      await sleep(between(random, 700, 1200) * scale, signal);

      // Demo scenario: the "model" misbehaves, so the app must fall back to the heuristic ranker.
      if (ctx.domain === FLAKY_DOMAIN) return "I'm not able to format that as JSON right now.";

      const json = JSON.stringify({ results: judge(candidates, ctx) }, null, 2);
      // Real models sometimes wrap JSON in a code fence; the parser handles both.
      return random() < 0.5 ? json : `\`\`\`json\n${json}\n\`\`\``;
    },
  };
}
