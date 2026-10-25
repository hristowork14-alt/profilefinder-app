// The core search pipeline: company → queries → search → filter/dedupe → rank.
// Pure orchestration; every external call is injected (real or mock) and time-boxed.

import { resolveCompanyName } from './companyName';
import { Deadline, withTimeout } from './deadline';
import { rankHeuristically } from './heuristicRanker';
import { normalizeLinkedInProfileUrl } from './linkedinUrl';
import { findSynonyms } from './positionSynonyms';
import { buildDomainQuery, buildNameQueries } from './queryBuilder';
import { rankWithClaude } from './rankWithClaude';
import type {
  Candidate,
  CompanyNameSource,
  HomepageFetcher,
  LlmClient,
  PipelineStep,
  RankedBy,
  RankedProfile,
  SearchHit,
  SearchProvider,
} from './types';

export class SearchUnavailableError extends Error {
  constructor(message = 'The search service did not respond. Please try again in a minute.') {
    super(message);
    this.name = 'SearchUnavailableError';
  }
}

export interface PipelineTiming {
  /** Hard ceiling for the whole pipeline. Netlify's limit is 30 s; we aim for < 10 s. */
  totalMs: number;
  homepageMs: number;
  searchMs: number;
  llmMs: number;
  /** Don't start a model call with less time than this left. */
  minLlmMs: number;
}

export const DEFAULT_TIMING: PipelineTiming = {
  totalMs: 9000,
  homepageMs: 3000,
  searchMs: 4000,
  llmMs: 5000,
  minLlmMs: 1500,
};

export interface PipelineDeps {
  searchProvider: SearchProvider;
  fetchHomepage: HomepageFetcher;
  llm: LlmClient | null;
  timing?: Partial<PipelineTiming>;
  onProgress?: (step: PipelineStep) => void;
  log?: (message: string) => void;
  now?: () => number;
}

export interface PipelineResult {
  domain: string;
  position: string;
  companyName: string;
  companySource: CompanyNameSource;
  queries: string[];
  candidates: Candidate[];
  results: RankedProfile[];
  rankedBy: RankedBy;
  searchErrors: number;
}

const RESULTS_PER_QUERY = 10;

export function filterAndDedupe(hits: SearchHit[]): Candidate[] {
  const bySlug = new Map<string, Candidate>();
  for (const hit of hits) {
    const normalized = normalizeLinkedInProfileUrl(hit.url);
    if (!normalized) continue;
    const existing = bySlug.get(normalized.slug);
    if (existing) {
      // Keep the richer snippet if the same person shows up in several queries.
      if (hit.snippet.length > existing.snippet.length) existing.snippet = hit.snippet;
      continue;
    }
    bySlug.set(normalized.slug, {
      title: (hit.title ?? '').slice(0, 300),
      snippet: (hit.snippet ?? '').slice(0, 600),
      linkedinUrl: normalized.url,
      slug: normalized.slug,
    });
  }
  return [...bySlug.values()];
}

export async function runSearchPipeline(input: { domain: string; position: string }, deps: PipelineDeps): Promise<PipelineResult> {
  const timing = { ...DEFAULT_TIMING, ...deps.timing };
  const deadline = new Deadline(timing.totalMs, deps.now);
  const log = deps.log ?? (() => {});
  const { domain, position } = input;
  const synonyms = findSynonyms(position);

  const runQuery = (query: string, reserveMs: number) =>
    withTimeout(`search "${query}"`, deadline.budget(timing.searchMs, reserveMs), (signal) =>
      deps.searchProvider.search(query, { signal, limit: RESULTS_PER_QUERY }),
    );

  // 1) Company name and the domain query start at the same time.
  deps.onProgress?.('company');
  const domainQuery = buildDomainQuery(domain, position);
  const domainSearch = runQuery(domainQuery, timing.minLlmMs);
  const homepage = withTimeout('homepage', deadline.budget(timing.homepageMs, timing.minLlmMs), (signal) =>
    deps.fetchHomepage(domain, signal),
  ).catch((error: unknown) => {
    log(`Homepage fetch failed for ${domain}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
  const company = resolveCompanyName(await homepage, domain);

  // 2) Name-based queries, in parallel with whatever is left of the domain query.
  deps.onProgress?.('search');
  const nameQueries = buildNameQueries(company.name, position, synonyms);
  const settled = await Promise.allSettled([...nameQueries.map((q) => runQuery(q, timing.minLlmMs)), domainSearch]);
  const queries = [...nameQueries, domainQuery];

  const hits: SearchHit[] = [];
  let searchErrors = 0;
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') hits.push(...outcome.value);
    else {
      searchErrors++;
      log(`Query failed (${queries[index]}): ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`);
    }
  });
  if (searchErrors === settled.length) throw new SearchUnavailableError();

  const candidates = filterAndDedupe(hits);
  const ctx = { companyName: company.name, domain, position, synonyms };
  const base = { domain, position, companyName: company.name, companySource: company.source, queries, candidates, searchErrors };

  // 3) Rank — Claude if available and there's time, otherwise the heuristic.
  deps.onProgress?.('rank');
  if (candidates.length === 0) return { ...base, results: [], rankedBy: deps.llm ? 'claude' : 'heuristic' };

  if (deps.llm && deadline.remaining() >= timing.minLlmMs) {
    const llm = deps.llm;
    try {
      const results = await withTimeout('ranking', deadline.budget(timing.llmMs, 200), (signal) =>
        rankWithClaude(candidates, ctx, llm, {
          timeoutMs: deadline.budget(timing.llmMs, 200),
          allowRetry: () => deadline.remaining() >= timing.minLlmMs,
          signal,
        }),
      );
      return { ...base, results, rankedBy: 'claude' };
    } catch (error) {
      log(`Claude ranking unavailable, using heuristic: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { ...base, results: rankHeuristically(candidates, ctx), rankedBy: 'heuristic' };
}
