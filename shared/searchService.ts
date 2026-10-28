// The search use-case around the pipeline: validate → cache → rate limit → pipeline →
// save history → write cache. Used by the Netlify function (Supabase store) and by the
// browser demo (memory store), so both behave identically.

import { SearchUnavailableError, runSearchPipeline, type PipelineDeps } from './pipeline';
import type { SearchStore } from './records';
import type { ApiErrorBody, SearchResponse } from './types';
import { validateSearchRequest } from './validation';

export interface SearchServiceConfig {
  maxSearchesPerHour: number;
  /** Optional daily cap per account, on top of the hourly one (protects search credits). */
  maxSearchesPerDay?: number;
  cacheTtlMs: number;
  /**
   * Epoch ms. Cache entries written before this are ignored, because they came from an older,
   * less accurate pipeline. Bump it whenever the way results are found or ranked changes.
   */
  cacheValidAfter?: number;
}

export const NO_RESULTS_MESSAGE = 'No matching profiles found — try a broader title.';
const NOT_SAVED_MESSAGE = 'Results could not be saved to your history.';

export type SearchOutcome = { status: 200; body: SearchResponse } | { status: 400 | 429 | 502; body: ApiErrorBody };

export interface SearchServiceDeps {
  store: SearchStore;
  pipelineDeps: PipelineDeps;
  config: SearchServiceConfig;
  now?: () => Date;
  log?: (message: string) => void;
}

export async function performSearch(userId: string, rawBody: unknown, deps: SearchServiceDeps): Promise<SearchOutcome> {
  const { store, config } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});

  const validation = validateSearchRequest(rawBody);
  if (!validation.ok) return { status: 400, body: { error: validation.error, code: 'invalid_input' } };
  const input = validation.value;

  if (input.bulkJobId && !(await store.userOwnsBulkJob(userId, input.bulkJobId))) {
    return { status: 400, body: { error: 'That bulk job was not found.', code: 'invalid_input' } };
  }

  const save = async (fields: Parameters<SearchStore['saveSearch']>[0]): Promise<string | null> => {
    try {
      return await store.saveSearch(fields);
    } catch (error) {
      log(`Saving search failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  // 1) Cache — served even when the user is over the hourly limit.
  let cached = null;
  const maxAgeMs =
    config.cacheValidAfter === undefined ? config.cacheTtlMs : Math.min(config.cacheTtlMs, now().getTime() - config.cacheValidAfter);
  try {
    if (maxAgeMs > 0) cached = await store.getCached(input.domain, input.positionNormalized, maxAgeMs);
  } catch (error) {
    log(`Cache read failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  // An empty cached answer is ignored (older versions cached them), so the company is searched
  // again — unless it carries a verified holder (a real answer: "X holds it, no public profile").
  if (cached && (cached.results.length > 0 || cached.verifiedHolder)) {
    const answered = cached.results.length > 0 || Boolean(cached.verifiedHolder);
    const searchId = await save({
      userId,
      bulkJobId: input.bulkJobId,
      companyUrl: input.companyUrl,
      domain: input.domain,
      companyName: cached.companyName,
      position: input.position,
      status: answered ? 'completed' : 'no_results',
      error: null,
      fromCache: true,
      results: cached.results,
      ...(cached.verifiedHolder !== undefined ? { verifiedHolder: cached.verifiedHolder } : {}),
      ...(cached.decision ? { decision: cached.decision } : {}),
    });
    return {
      status: 200,
      body: {
        searchId,
        companyName: cached.companyName,
        domain: input.domain,
        position: input.position,
        results: cached.results,
        fromCache: true,
        rankedBy: 'cache',
        message: !answered ? NO_RESULTS_MESSAGE : searchId ? null : NOT_SAVED_MESSAGE,
        ...(cached.verifiedHolder !== undefined ? { verifiedHolder: cached.verifiedHolder } : {}),
        ...(cached.decision ? { decision: cached.decision } : {}),
      },
    };
  }

  // 2) Rate limits — only fresh searches count (not cache hits, not searches that failed on our side).
  const since = new Date(now().getTime() - 60 * 60 * 1000);
  const used = await store.countFreshSearchesSince(userId, since);
  if (used >= config.maxSearchesPerHour) {
    return {
      status: 429,
      body: {
        error: `You've reached the limit of ${config.maxSearchesPerHour} new searches per hour. Searches you've already run still work — please try again a bit later.`,
        code: 'rate_limited',
      },
    };
  }
  if (config.maxSearchesPerDay !== undefined) {
    const usedToday = await store.countFreshSearchesSince(userId, new Date(now().getTime() - 24 * 60 * 60 * 1000));
    if (usedToday >= config.maxSearchesPerDay) {
      return {
        status: 429,
        body: {
          error: `You've reached the limit of ${config.maxSearchesPerDay} new searches per day. Searches you've already run still work — please try again tomorrow.`,
          code: 'rate_limited',
        },
      };
    }
  }

  // 3) Pipeline.
  let result;
  try {
    result = await runSearchPipeline({ domain: input.domain, position: input.position }, { ...deps.pipelineDeps, log });
  } catch (error) {
    const message =
      error instanceof SearchUnavailableError ? error.message : 'Something went wrong while searching. Please try again in a minute.';
    log(`Search failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    await save({
      userId,
      bulkJobId: input.bulkJobId,
      companyUrl: input.companyUrl,
      domain: input.domain,
      companyName: null,
      position: input.position,
      status: 'failed',
      error: message,
      fromCache: false,
      results: [],
    });
    return { status: 502, body: { error: message, code: 'search_failed' } };
  }

  // One summary line per search for the function logs — no personal data (no names).
  const { trace } = result;
  log(
    `search ${input.domain} "${input.position}" | ${trace.decision} | ${trace.timings.totalMs} ms | ${trace.queries.length} queries | extraction ${trace.extraction} | ${result.results.length} results`,
  );

  // 4) Save to history (with the diagnostics, stored server-side only).
  const answered = result.results.length > 0 || Boolean(result.verifiedHolder);
  const decision = trace.decision === 'not_checked' ? undefined : trace.decision;
  const searchId = await save({
    userId,
    bulkJobId: input.bulkJobId,
    companyUrl: input.companyUrl,
    domain: input.domain,
    companyName: result.companyName,
    position: input.position,
    status: answered ? 'completed' : 'no_results',
    error: null,
    fromCache: false,
    results: result.results,
    ...(result.verifiedHolder !== undefined ? { verifiedHolder: result.verifiedHolder } : {}),
    ...(decision ? { decision } : {}),
    diagnostics: trace,
  });

  // 5) Cache only complete, best-quality answers: all queries succeeded, the results came from
  //    Claude (or no model is configured at all), and there is an answer (profiles, or a verified
  //    holder without a public profile). A heuristic fallback is not cached so the next attempt can
  //    get Claude's ranking, and an empty answer is not cached so a temporary miss doesn't stick.
  const cacheable = result.searchErrors === 0 && answered && (result.rankedBy === 'claude' || !deps.pipelineDeps.llm);
  if (cacheable) {
    try {
      await store.putCached({
        domain: input.domain,
        positionNormalized: input.positionNormalized,
        companyName: result.companyName,
        results: result.results,
        ...(result.verifiedHolder !== undefined ? { verifiedHolder: result.verifiedHolder } : {}),
        ...(decision ? { decision } : {}),
      });
    } catch (error) {
      log(`Cache write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    status: 200,
    body: {
      searchId,
      companyName: result.companyName,
      domain: input.domain,
      position: input.position,
      results: result.results,
      fromCache: false,
      rankedBy: result.rankedBy,
      message: !answered ? NO_RESULTS_MESSAGE : searchId ? null : NOT_SAVED_MESSAGE,
      ...(result.verifiedHolder !== undefined ? { verifiedHolder: result.verifiedHolder } : {}),
      ...(decision ? { decision } : {}),
    },
  };
}
