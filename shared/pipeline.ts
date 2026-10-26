// The core search pipeline: company → queries → search → filter/dedupe → rank → decide.
// Pure orchestration; every external call is injected (real or mock) and time-boxed.
//
// With `corroborate` (real app only), the result is verified before anything is shown:
//   S1  two independent web queries (LinkedIn excluded) start at t=0, plus one with the resolved
//       company name when it differs from the domain;
//   S2  names are read from that evidence by regex and, when available, by Claude (validated);
//   S3  the verified person is looked up on LinkedIn by name, with a nickname variant;
//   S4  profile-quality signals go to the ranker;
//   S5  decision.ts decides what the user sees.
// Every query, the evidence and the decision are recorded in `trace` (no snippets).

import { resolveCompanyName } from './companyName';
import { corroborationFor, evidenceRoleTerms, extractNamedPeople, namesMatch, type EvidenceName } from './corroboration';
import { Deadline, withTimeout } from './deadline';
import { decideResults, type Decision } from './decision';
import { domainToCompanyName } from './domain';
import { extractHolderWithClaude, type ExtractedHolder } from './extractHolder';
import { parseLinkedInTitle, rankHeuristically } from './heuristicRanker';
import { normalizeLinkedInProfileUrl } from './linkedinUrl';
import { findSynonyms, normalizePosition } from './positionSynonyms';
import {
  buildDomainQuery,
  buildEvidenceQuery,
  buildNameQueries,
  buildPersonQueries,
  buildQuestionQuery,
  queryMentions,
} from './queryBuilder';
import { rankWithClaude } from './rankWithClaude';
import type {
  Candidate,
  CompanyNameSource,
  HomepageFetcher,
  LlmClient,
  PipelineStep,
  RankedBy,
  RankedProfile,
  RankingContext,
  SearchHit,
  SearchProvider,
  VerifiedHolder,
} from './types';

export class SearchUnavailableError extends Error {
  constructor(message = 'The search service did not respond. Please try again in a minute.') {
    super(message);
    this.name = 'SearchUnavailableError';
  }
}

export interface PipelineTiming {
  /** Hard ceiling for the whole pipeline. Netlify's synchronous limit is 60 s; we aim for ≤ 20 s. */
  totalMs: number;
  homepageMs: number;
  searchMs: number;
  llmMs: number;
  /** Time allowed for Claude to read the independent evidence (S2). */
  extractMs: number;
  /** Don't start a model call with less time than this left. */
  minLlmMs: number;
}

export const DEFAULT_TIMING: PipelineTiming = {
  totalMs: 18000,
  homepageMs: 3000,
  searchMs: 4000,
  llmMs: 5000,
  extractMs: 3000,
  minLlmMs: 1500,
};

export interface PipelineDeps {
  searchProvider: SearchProvider;
  fetchHomepage: HomepageFetcher;
  llm: LlmClient | null;
  /**
   * Verify who holds the role through independent sources before showing profiles (see the
   * header). Costs up to ~5 extra search queries and 1 model call. On in the real app; off in the
   * demo and with USE_MOCKS.
   */
  corroborate?: boolean;
  timing?: Partial<PipelineTiming>;
  onProgress?: (step: PipelineStep) => void;
  log?: (message: string) => void;
  now?: () => number;
}

export type QueryKind = 'linkedin' | 'evidence' | 'person';

export interface QueryTrace {
  query: string;
  kind: QueryKind;
  hits: number;
  ms: number;
  error?: string;
  /** Person lookups only: the names on the LinkedIn profiles returned (names only, no snippets). */
  profiles?: string[];
}

/** How the holder was read from the evidence. 'tie': the regex named two people equally often and Claude didn't settle it. */
export type Extraction = 'none' | 'regex' | 'claude' | 'agree' | 'disagree' | 'tie';

/** What happened during one search. Stored server-side for debugging; never contains snippets. */
export interface PipelineTrace {
  queries: QueryTrace[];
  evidence: { name: string; sources: number; hosts: string[]; via: 'regex' | 'claude' | 'both' }[];
  extraction: Extraction;
  decision: Decision | 'not_checked';
  timings: { homepageMs: number | null; evidenceMs: number | null; extractionMs: number | null; rankMs: number | null; totalMs: number };
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
  /** People independent sources name in the role ([] when verification is off or found nobody). */
  evidence: EvidenceName[];
  /** Only set when verification ran: the verified holder, or null if no one could be confirmed. */
  verifiedHolder?: VerifiedHolder | null;
  trace: PipelineTrace;
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

/** Names on the LinkedIn profiles among search hits (for diagnostics: names only). */
function profileNames(hits: SearchHit[]): string[] {
  const names = hits.filter((h) => normalizeLinkedInProfileUrl(h.url)).map((h) => parseLinkedInTitle(h.title ?? '').name.slice(0, 80));
  return [...new Set(names.filter(Boolean))].slice(0, 5);
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** The full title for the question query when the user typed an abbreviation ("CEO" → "Chief Executive Officer"). */
function questionTitle(position: string, synonyms: string[]): string {
  return /^[A-Z]{2,5}$/.test(position.trim()) ? (evidenceRoleTerms(position, synonyms)[1] ?? position) : position;
}

/** The regex reading's favourite, or null when it names nobody — or two people equally often. */
function regexFavourite(names: EvidenceName[]): { top: EvidenceName | null; tie: boolean } {
  const [top, second] = names;
  if (!top) return { top: null, tie: false };
  const tie = Boolean(second && second.sources === top.sources && !namesMatch(second.name, top.name));
  return { top: tie ? null : top, tie };
}

/** Combines the regex and Claude readings of the evidence (S2 agreement rule). */
function agree(
  regexTop: EvidenceName | null,
  claude: ExtractedHolder | null,
  minSources: number,
  regexTie = false,
): { holder: VerifiedHolder | null; extraction: Extraction } {
  const fromRegex = regexTop && regexTop.sources >= minSources ? regexTop : null;
  const fromClaude = claude && claude.sources >= minSources ? claude : null;
  const toHolder = (e: { name: string; sources: number; links?: VerifiedHolder['sourceLinks'] }): VerifiedHolder => ({
    name: e.name,
    sources: e.sources,
    sourceLinks: e.links ?? [],
  });
  if (fromRegex && fromClaude) {
    if (namesMatch(fromRegex.name, fromClaude.name)) {
      const richer = fromClaude.sources >= fromRegex.sources ? fromClaude : fromRegex;
      return {
        holder: { ...toHolder(richer), name: fromClaude.name, sources: Math.max(fromRegex.sources, fromClaude.sources) },
        extraction: 'agree',
      };
    }
    if (fromRegex.sources === fromClaude.sources) return { holder: null, extraction: 'disagree' };
    return { holder: toHolder(fromRegex.sources > fromClaude.sources ? fromRegex : fromClaude), extraction: 'disagree' };
  }
  if (fromClaude) return { holder: toHolder(fromClaude), extraction: 'claude' };
  if (fromRegex) return { holder: toHolder(fromRegex), extraction: 'regex' };
  return { holder: null, extraction: regexTie ? 'tie' : 'none' };
}

export async function runSearchPipeline(input: { domain: string; position: string }, deps: PipelineDeps): Promise<PipelineResult> {
  const timing = { ...DEFAULT_TIMING, ...deps.timing };
  const clock = deps.now ?? (() => Date.now());
  const startedAt = clock();
  const deadline = new Deadline(timing.totalMs, deps.now);
  const log = deps.log ?? (() => {});
  const { domain, position } = input;
  const synonyms = findSynonyms(position);
  const verify = Boolean(deps.corroborate);

  const trace: PipelineTrace = {
    queries: [],
    evidence: [],
    extraction: 'none',
    decision: 'not_checked',
    timings: { homepageMs: null, evidenceMs: null, extractionMs: null, rankMs: null, totalMs: 0 },
  };
  /** Runs one search query, recording kind, hit count, time and error in the trace. */
  const runQuery = (query: string, kind: QueryKind, reserveMs: number): Promise<SearchHit[]> => {
    const started = clock();
    return withTimeout(`search "${query}"`, deadline.budget(timing.searchMs, reserveMs), (signal) =>
      deps.searchProvider.search(query, { signal, limit: RESULTS_PER_QUERY }),
    ).then(
      (hits) => {
        trace.queries.push({
          query,
          kind,
          hits: hits.length,
          ms: clock() - started,
          ...(kind === 'person' ? { profiles: profileNames(hits) } : {}),
        });
        return hits;
      },
      (error: unknown) => {
        trace.queries.push({ query, kind, hits: 0, ms: clock() - started, error: errorText(error).slice(0, 200) });
        throw error;
      },
    );
  };

  // 1) Company name, the domain query and (when verifying) the independent evidence start together.
  deps.onProgress?.('company');
  const domainQuery = buildDomainQuery(domain, position);
  const domainSearch = runQuery(domainQuery, 'linkedin', timing.minLlmMs);
  const homepageStarted = clock();
  const homepage = withTimeout('homepage', deadline.budget(timing.homepageMs, timing.minLlmMs), (signal) =>
    deps.fetchHomepage(domain, signal),
  ).catch((error: unknown) => {
    log(`Homepage fetch failed for ${domain}: ${errorText(error)}`);
    return null;
  });

  let evidenceErrors = 0;
  // Failure handlers are attached right away, so an early failure is never an unhandled rejection.
  const evidenceQuery = (query: string) =>
    runQuery(query, 'evidence', timing.minLlmMs).catch((error: unknown) => {
      evidenceErrors++;
      log(`Evidence query failed (${query}): ${errorText(error)}`);
      return [] as SearchHit[];
    });
  const provisionalName = domainToCompanyName(domain);
  const evidenceSearches: Promise<SearchHit[]>[] = verify
    ? [
        evidenceQuery(buildEvidenceQuery(provisionalName, position)),
        evidenceQuery(buildQuestionQuery(provisionalName, questionTitle(position, synonyms))),
      ]
    : [];

  const company = resolveCompanyName(await homepage, domain);
  trace.timings.homepageMs = clock() - homepageStarted;
  const ctxBase: RankingContext = { companyName: company.name, domain, position, synonyms };
  if (verify && normalizePosition(company.name) !== normalizePosition(provisionalName)) {
    // The real brand differs from the domain ("mailchimp" for intuit-mc.com): ask again with it.
    evidenceSearches.push(evidenceQuery(buildEvidenceQuery(company.name, position)));
  }

  // 2) LinkedIn name queries, in parallel with the evidence chain: read the evidence, agree on a
  //    holder, and look that person up by name (S1–S3).
  deps.onProgress?.('search');
  const nameQueries = buildNameQueries(company.name, position, synonyms);
  const linkedinQueries = [...nameQueries, domainQuery];

  let regexNames: EvidenceName[] = [];
  let holder: VerifiedHolder | null = null;
  let usedModelForExtraction = false;
  let personErrors = 0;
  /** Profiles returned for "<name>" "<company>": Google matched the company on those pages. */
  const foundWithCompany = new Set<string>();
  const lookUp = async (name: string): Promise<SearchHit[]> => {
    const queries = buildPersonQueries(name, company.name);
    const settled = await Promise.allSettled(queries.map((q) => runQuery(q, 'person', timing.minLlmMs)));
    return settled.flatMap((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        if (queryMentions(queries[index] ?? '', company.name)) {
          for (const hit of outcome.value) {
            const slug = normalizeLinkedInProfileUrl(hit.url)?.slug;
            if (slug) foundWithCompany.add(slug);
          }
        }
        return outcome.value;
      }
      personErrors++;
      return [];
    });
  };

  const evidenceChain = async (): Promise<SearchHit[]> => {
    if (!verify) return [];
    const evidenceStarted = clock();
    const evidenceHits = [...new Map((await Promise.all(evidenceSearches)).flat().map((h) => [h.url, h])).values()].filter(
      (h) => !/(^|\.)linkedin\.com\//i.test(h.url.replace(/^https?:\/\//, '')),
    );
    trace.timings.evidenceMs = clock() - evidenceStarted;
    regexNames = extractNamedPeople(evidenceHits, ctxBase);
    // Two people named equally often (often the current and a former holder): the regex can't
    // tell which one holds the role, so only Claude's reading can decide.
    const { top: regexTop, tie: regexTie } = regexFavourite(regexNames);
    // Start looking up the regex favourite right away; Claude usually agrees.
    const early = regexTop ? lookUp(regexTop.name) : Promise.resolve([] as SearchHit[]);

    let claude: ExtractedHolder | null = null;
    if (deps.llm && evidenceHits.length > 0 && deadline.remaining() >= timing.minLlmMs * 2) {
      const llm = deps.llm;
      const extractionStarted = clock();
      usedModelForExtraction = true;
      try {
        claude = await withTimeout('evidence extraction', deadline.budget(timing.extractMs, timing.minLlmMs), (signal) =>
          extractHolderWithClaude(evidenceHits, ctxBase, llm, { timeoutMs: deadline.budget(timing.extractMs, timing.minLlmMs), signal }),
        );
      } catch (error) {
        log(`Evidence extraction unavailable, using regex: ${errorText(error)}`);
      }
      trace.timings.extractionMs = clock() - extractionStarted;
    }

    const agreed = agree(regexTop, claude, 2, regexTie);
    holder = agreed.holder;
    trace.extraction = agreed.extraction;
    trace.evidence = regexNames.map((e) => ({
      name: e.name,
      sources: e.sources,
      hosts: e.hosts ?? [],
      via: claude && namesMatch(claude.name, e.name) ? 'both' : 'regex',
    }));
    if (claude && !regexNames.some((e) => namesMatch(e.name, claude!.name))) {
      trace.evidence.unshift({
        name: claude.name,
        sources: claude.sources,
        hosts: claude.links.map((l) => safeHostname(l.url)),
        via: 'claude',
      });
    }

    const earlyHits = await early;
    const verified = holder as VerifiedHolder | null;
    if (verified && (!regexTop || !namesMatch(verified.name, regexTop.name))) return [...(await lookUp(verified.name)), ...earlyHits];
    return earlyHits;
  };

  const [settled, personHits] = await Promise.all([
    Promise.allSettled([...nameQueries.map((q) => runQuery(q, 'linkedin', timing.minLlmMs)), domainSearch]),
    evidenceChain(),
  ]);

  // Profiles found by name (from independent evidence) go first, so they're never cut off by the
  // candidate limit in the ranking prompt.
  const hits: SearchHit[] = [...personHits];
  let searchErrors = 0;
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') hits.push(...outcome.value);
    else {
      searchErrors++;
      log(`Query failed (${linkedinQueries[index]}): ${errorText(outcome.reason)}`);
    }
  });
  if (searchErrors === settled.length) throw new SearchUnavailableError();
  // Failed evidence or person queries don't stop the search, but the answer is incomplete (not cached).
  searchErrors += evidenceErrors + personErrors;

  const verifiedHolder = holder as VerifiedHolder | null;
  // Evidence shown to the ranker: the verified holder first, then other names the regex found.
  const evidence: EvidenceName[] = verify
    ? [
        ...(verifiedHolder ? [{ name: verifiedHolder.name, sources: verifiedHolder.sources, links: verifiedHolder.sourceLinks }] : []),
        ...regexNames.filter((e) => !verifiedHolder || !namesMatch(e.name, verifiedHolder.name)),
      ]
    : [];
  const queries = trace.queries.map((q) => q.query);
  const candidates = filterAndDedupe(hits);
  if (verify) {
    for (const candidate of candidates) {
      candidate.corroboratedBy = corroborationFor(parseLinkedInTitle(candidate.title).name, evidence);
      if (foundWithCompany.has(candidate.slug)) candidate.foundWithCompany = true;
    }
  }
  const ctx: RankingContext = { ...ctxBase, ...(verify ? { evidence } : {}) };
  const base = {
    domain,
    position,
    companyName: company.name,
    companySource: company.source,
    queries,
    candidates,
    searchErrors,
    evidence,
    trace,
  };

  const finish = (results: RankedProfile[], rankedBy: RankedBy): PipelineResult => {
    if (!verify) {
      trace.timings.totalMs = clock() - startedAt;
      return { ...base, results, rankedBy };
    }
    const decided = decideResults(results, candidates, verifiedHolder, ctx, { rankerReadProfiles: rankedBy === 'claude' });
    trace.decision = decided.decision;
    trace.timings.totalMs = clock() - startedAt;
    return { ...base, results: decided.results, rankedBy, verifiedHolder: decided.verifiedHolder };
  };

  // 3) Rank — Claude if available and there's time, otherwise the heuristic. At most 2 model
  //    calls per search: no ranking retry when Claude already read the evidence.
  deps.onProgress?.('rank');
  if (candidates.length === 0) return finish([], deps.llm ? 'claude' : 'heuristic');

  const rankStarted = clock();
  if (deps.llm && deadline.remaining() >= timing.minLlmMs) {
    const llm = deps.llm;
    try {
      const results = await withTimeout('ranking', deadline.budget(timing.llmMs, 200), (signal) =>
        rankWithClaude(candidates, ctx, llm, {
          timeoutMs: deadline.budget(timing.llmMs, 200),
          allowRetry: () => !usedModelForExtraction && deadline.remaining() >= timing.minLlmMs,
          signal,
        }),
      );
      trace.timings.rankMs = clock() - rankStarted;
      return finish(results, 'claude');
    } catch (error) {
      log(`Claude ranking unavailable, using heuristic: ${errorText(error)}`);
    }
  }
  const results = rankHeuristically(candidates, ctx);
  trace.timings.rankMs = clock() - rankStarted;
  return finish(results, 'heuristic');
}
