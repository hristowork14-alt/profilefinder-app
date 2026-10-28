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
// For roles many people hold (Mechanical Engineer …) there is no single holder to verify; instead
// the search widens in tiers until it has enough credible people (or hits the credit cap):
//   tier 1  today's queries;
//   tier 2  other forms of the title (rules + Claude, with translations into the languages the
//           company's people use), the company's other names, one looser unquoted query;
//   tier 3  more results for the main query.
// Every query (with the credits it cost), the evidence, the candidate funnel and the decision are
// recorded in `trace` (no snippets).

import { brandFamilyNames, extractCompanyAliases, resolveCompanyName } from './companyName';
import {
  MIN_SOURCES,
  corroborationFor,
  evidenceRoleTerms,
  extractNamedPeople,
  isUsableEvidence,
  namesMatch,
  type EvidenceName,
} from './corroboration';
import { Deadline, withTimeout } from './deadline';
import { MAX_MANY_RESULTS, closestMatches, decideResults, otherEmployer, type Decision } from './decision';
import { domainToCompanyName } from './domain';
import { extractHolderWithClaude, type ExtractedHolder } from './extractHolder';
import { parseLinkedInTitle, rankHeuristically } from './heuristicRanker';
import { normalizeLinkedInProfileUrl } from './linkedinUrl';
import { findSynonyms, normalizePosition } from './positionSynonyms';
import {
  buildDomainQuery,
  buildEvidenceQuery,
  buildLooseQuery,
  buildNameQueries,
  buildNameQuery,
  buildPersonQueries,
  buildPersonRoleQuery,
  buildQuestionQuery,
  queryMentions,
} from './queryBuilder';
import { rankManyWithClaude } from './rankMany';
import { rankWithClaude } from './rankWithClaude';
import { isSingleHolderRole, topRoleTitles } from './roleKind';
import { mentionsCompany } from './sourceQuality';
import { generateVariants, languageFromHomepage, languagesFromHits, pickLanguages, ruleVariants } from './titleVariants';
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
  /** Credits the search provider charged, when it reports them. */
  credits?: number;
  /** Search tier (roles many people hold): 1 = first round, 2 = widened, 3 = more results. */
  tier?: number;
}

/**
 * How the holder was read from the evidence. 'tie': the regex named two people equally often and
 * Claude didn't settle it. 'likely': only one strong source names them. 'top-role': nobody was
 * named for the exact title, but the top role of its function was ("Chief Design Officer").
 */
export type Extraction = 'none' | 'regex' | 'claude' | 'agree' | 'disagree' | 'tie' | 'likely' | 'top-role';

/** Counts only (no names): how many candidates were found, kept and shown, and what it cost. */
export interface SearchFunnel {
  candidates: number;
  credible: number;
  shown: number;
  /** Highest search tier used (1–3). */
  tiers: number;
  credits: number;
  variants: number;
  aliases: number;
  languages: string[];
}

/** What happened during one search. Stored server-side for debugging; never contains snippets. */
export interface PipelineTrace {
  queries: QueryTrace[];
  evidence: { name: string; sources: number; hosts: string[]; via: 'regex' | 'claude' | 'both' }[];
  extraction: Extraction;
  decision: Decision | 'not_checked';
  timings: { homepageMs: number | null; evidenceMs: number | null; extractionMs: number | null; rankMs: number | null; totalMs: number };
  /** Real app only. */
  funnel?: SearchFunnel;
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
  /** Other forms of the title and company names also searched for (real app, roles many people hold). */
  triedTitles?: string[];
  trace: PipelineTrace;
}

const RESULTS_PER_QUERY = 10;
/** Roles many people hold: stop widening once this many credible people were found. */
const TARGET_MANY = 10;
/** Roles many people hold: never spend more than this many search credits on one search. */
const CREDIT_CAP_MANY = 14;
/** Results asked for in the last tier (reported as 2 credits instead of 1). */
const DEEP_RESULTS = 50;
/** Most candidates and variants used. */
const MAX_TIER2_VARIANTS = 4;
const MAX_ALIASES = 4;

/** Hidden or anonymous profiles: the name can't be checked against anything. */
const ANONYMOUS_PROFILE = /^(?:linkedin member|private profile|profile unavailable)$/i;

export function filterAndDedupe(hits: SearchHit[]): Candidate[] {
  const bySlug = new Map<string, Candidate>();
  for (const hit of hits) {
    const normalized = normalizeLinkedInProfileUrl(hit.url);
    if (!normalized) continue;
    const name = parseLinkedInTitle(hit.title ?? '').name;
    if (!name || ANONYMOUS_PROFILE.test(name)) continue;
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

/** Same full name, letter for letter (accents and case aside) — no nickname matching. */
function exactSameName(a: string, b: string): boolean {
  const key = (n: string) =>
    n
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\s-]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .join(' ');
  const ka = key(a);
  return ka.split(' ').length >= 2 && ka === key(b);
}

/** Candidates that state the role (or a variant) at the company (or an alias): a cheap count to decide whether to widen. */
function credibleCount(candidates: Candidate[], ctx: RankingContext): number {
  return rankHeuristically(candidates, ctx, { maxResults: candidates.length }).filter((r) => r.confidence >= 50).length;
}

interface Reading {
  name: string;
  /** Weighted support (threshold). */
  sources: number;
  /** Distinct websites (what the user is told). */
  sites?: number;
  strongSites?: number;
  links?: VerifiedHolder['sourceLinks'];
}

/**
 * Combines the regex and Claude readings of the evidence (S2 agreement rule). A reading counts
 * only with enough support from at least one non-weak website. When both readings count but name
 * different people, nobody is verified: the sources disagree, and showing either one as
 * "verified" risks a confident wrong answer.
 */
function agree(
  regexTop: Reading | null,
  claude: Reading | null,
  minSources: number,
  regexTie = false,
): { holder: VerifiedHolder | null; extraction: Extraction } {
  const qualifies = (e: Reading | null): e is Reading => Boolean(e && e.sources >= minSources && (e.strongSites ?? 1) >= 1);
  const fromRegex = qualifies(regexTop) ? regexTop : null;
  const fromClaude = qualifies(claude) ? claude : null;
  const toHolder = (e: Reading): VerifiedHolder => ({ name: e.name, sources: e.sites ?? e.sources, sourceLinks: e.links ?? [] });
  if (fromRegex && fromClaude) {
    if (!namesMatch(fromRegex.name, fromClaude.name)) return { holder: null, extraction: 'disagree' };
    const richer = fromClaude.sources >= fromRegex.sources ? fromClaude : fromRegex;
    return {
      holder: {
        ...toHolder(richer),
        name: fromClaude.name,
        sources: Math.max(fromRegex.sites ?? 0, fromClaude.sites ?? 0) || richer.sources,
      },
      extraction: 'agree',
    };
  }
  if (fromClaude) return { holder: toHolder(fromClaude), extraction: 'claude' };
  if (fromRegex) return { holder: toHolder(fromRegex), extraction: 'regex' };
  return { holder: null, extraction: regexTie ? 'tie' : 'none' };
}

/**
 * When nobody reaches the threshold: one person named by exactly one strong (non-weak) website,
 * with no other reading naming someone else. Shown as "likely", never as verified.
 */
function likelyReading(regexAll: Reading[], claude: Reading | null): VerifiedHolder | null {
  const strongOne = (e: Reading | null | undefined): e is Reading => Boolean(e && e.sources >= 1 && (e.strongSites ?? 0) >= 1);
  const regex = regexAll.filter(strongOne);
  const pick = strongOne(claude) ? claude : regex.length === 1 ? regex[0]! : null;
  if (!pick) return null;
  if (regex.some((e) => !namesMatch(e.name, pick.name) && e.sources >= pick.sources)) return null;
  return { name: pick.name, sources: pick.sites ?? 1, sourceLinks: pick.links ?? [] };
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
  // Only a role one person holds (CEO, Head of Design) can have a verified holder; for roles many
  // people hold (Engineer) the search widens instead, and the decision step filters what is shown.
  const seekHolder = verify && isSingleHolderRole(position);
  const manyHolders = verify && !seekHolder;

  const trace: PipelineTrace = {
    queries: [],
    evidence: [],
    extraction: 'none',
    decision: 'not_checked',
    timings: { homepageMs: null, evidenceMs: null, extractionMs: null, rankMs: null, totalMs: 0 },
  };
  /** Runs one search query, recording kind, hit count, time, credits and error in the trace. */
  const runQuery = (
    query: string,
    kind: QueryKind,
    reserveMs: number,
    extra: { limit?: number; tier?: number } = {},
  ): Promise<SearchHit[]> => {
    const started = clock();
    let credits: number | undefined;
    const record = (fields: Partial<QueryTrace>) =>
      trace.queries.push({
        query,
        kind,
        hits: 0,
        ms: clock() - started,
        ...(credits !== undefined ? { credits } : {}),
        ...(extra.tier ? { tier: extra.tier } : {}),
        ...fields,
      });
    return withTimeout(`search "${query}"`, deadline.budget(timing.searchMs, reserveMs), (signal) =>
      deps.searchProvider.search(query, {
        signal,
        limit: extra.limit ?? RESULTS_PER_QUERY,
        ...(verify ? { onUsage: (c: number) => (credits = c) } : {}),
      }),
    ).then(
      (hits) => {
        record({ hits: hits.length, ...(kind === 'person' ? { profiles: profileNames(hits) } : {}) });
        return hits;
      },
      (error: unknown) => {
        record({ error: errorText(error).slice(0, 200) });
        throw error;
      },
    );
  };
  /** Credits used so far (1 per query when the provider doesn't say). */
  const creditsUsed = () => trace.queries.reduce((sum, q) => sum + (q.credits ?? 1), 0);

  // 1) Company name, the domain query and (when verifying) the independent evidence start together.
  deps.onProgress?.('company');
  const domainQuery = buildDomainQuery(domain, position);
  const domainSearch = runQuery(domainQuery, 'linkedin', timing.minLlmMs, { tier: manyHolders ? 1 : undefined });
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
  const evidenceSearches: Promise<SearchHit[]>[] = seekHolder
    ? [
        evidenceQuery(buildEvidenceQuery(provisionalName, position)),
        evidenceQuery(buildQuestionQuery(provisionalName, questionTitle(position, synonyms))),
      ]
    : [];

  const html = await homepage;
  const company = resolveCompanyName(html, domain);
  trace.timings.homepageMs = clock() - homepageStarted;
  const ctxBase: RankingContext = { companyName: company.name, domain, position, synonyms };
  if (seekHolder && normalizePosition(company.name) !== normalizePosition(provisionalName)) {
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
  let likely = false;
  let usedModelForExtraction = false;
  let personErrors = 0;
  /** Profiles returned for "<name>" "<company>": Google matched the company on those pages. */
  const foundWithCompany = new Set<string>();
  /** Profiles returned for the name without the company (for the "only exact-name profile" rule). */
  const nameOnlyHits: SearchHit[] = [];
  /** A person lookup; a query that fails is retried once if there is time (Serper is sometimes slow). */
  const personQuery = (query: string): Promise<SearchHit[]> =>
    runQuery(query, 'person', timing.minLlmMs).catch((error: unknown) => {
      if (deadline.remaining() >= timing.searchMs + timing.minLlmMs) return runQuery(query, 'person', timing.minLlmMs);
      throw error;
    });
  const lookUp = async (name: string): Promise<SearchHit[]> => {
    const queries = buildPersonQueries(name, company.name);
    const settled = await Promise.allSettled(queries.map(personQuery));
    return settled.flatMap((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        if (queryMentions(queries[index] ?? '', company.name)) {
          for (const hit of outcome.value) {
            const slug = normalizeLinkedInProfileUrl(hit.url)?.slug;
            if (slug) foundWithCompany.add(slug);
          }
        } else {
          nameOnlyHits.push(...outcome.value);
        }
        return outcome.value;
      }
      personErrors++;
      return [];
    });
  };
  /** True when a lookup found a profile tied to the company (with it in the query, or naming it). */
  const tiedToCompany = (hits: SearchHit[]) =>
    filterAndDedupe(hits).some((c) => foundWithCompany.has(c.slug) || mentionsCompany(`${c.title} ${c.snippet}`, ctxBase));

  const evidenceChain = async (): Promise<SearchHit[]> => {
    if (!seekHolder) return [];
    const evidenceStarted = clock();
    // Only results about this company count (not LinkedIn, not job ads): see corroboration.ts.
    const evidenceHits = [...new Map((await Promise.all(evidenceSearches)).flat().map((h) => [h.url, h])).values()].filter((h) =>
      isUsableEvidence(h, ctxBase),
    );
    trace.timings.evidenceMs = clock() - evidenceStarted;
    const allNames = extractNamedPeople(evidenceHits, ctxBase, { minSources: 1 });
    regexNames = allNames.filter((e) => e.sources >= MIN_SOURCES);
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

    const agreed = agree(regexTop, claude, MIN_SOURCES, regexTie);
    holder = agreed.holder;
    trace.extraction = agreed.extraction;
    trace.evidence = allNames.map((e) => ({
      name: e.name,
      sources: e.sources,
      hosts: e.hosts ?? [],
      via: claude && namesMatch(claude.name, e.name) ? 'both' : 'regex',
    }));
    if (claude && !allNames.some((e) => namesMatch(e.name, claude!.name))) {
      trace.evidence.unshift({
        name: claude.name,
        sources: claude.sources,
        hosts: claude.links.map((l) => safeHostname(l.url)),
        via: 'claude',
      });
    }

    // Nobody reaches the threshold: one strong source is shown as "likely" (never verified).
    if (!holder && agreed.extraction !== 'disagree' && agreed.extraction !== 'tie') {
      const one = likelyReading(allNames, claude);
      if (one) {
        holder = one;
        likely = true;
        trace.extraction = 'likely';
      }
    }

    // Nobody named for "Head of X": try the top role of that function ("Chief Design Officer").
    if (!holder && deadline.remaining() >= timing.searchMs + timing.llmMs) {
      for (const top of topRoleTitles(position, synonyms)) {
        const topHits = (await evidenceQuery(buildEvidenceQuery(company.name, top))).filter((h) => isUsableEvidence(h, ctxBase));
        const topCtx: RankingContext = { ...ctxBase, position: top, synonyms: [] };
        const named = extractNamedPeople([...evidenceHits, ...topHits], topCtx, { minSources: 1 });
        const strong = named.filter((e) => e.sources >= MIN_SOURCES);
        const { top: favourite } = regexFavourite(strong);
        const pick: VerifiedHolder | null = favourite
          ? { name: favourite.name, sources: favourite.sites ?? favourite.sources, sourceLinks: favourite.links ?? [] }
          : likelyReading(named, null);
        if (pick) {
          holder = { ...pick, role: top };
          likely = !favourite;
          trace.extraction = 'top-role';
          break;
        }
        if (deadline.remaining() < timing.searchMs + timing.llmMs) break;
      }
    }

    const earlyHits = await early;
    const found = holder as VerifiedHolder | null;
    if (!found) return earlyHits;
    const hits = !regexTop || !namesMatch(found.name, regexTop.name) ? [...(await lookUp(found.name)), ...earlyHits] : earlyHits;
    // No profile tied to the company: one more lookup with the name and the role.
    if (!tiedToCompany(hits) && deadline.remaining() >= timing.searchMs + timing.minLlmMs) {
      const byRole = await personQuery(buildPersonRoleQuery(found.name, found.role ?? position)).catch(() => {
        personErrors++;
        return [] as SearchHit[];
      });
      nameOnlyHits.push(...byRole);
      hits.push(...byRole);
    }
    return hits;
  };

  const [settled, personHits] = await Promise.all([
    Promise.allSettled([
      ...nameQueries.map((q) => runQuery(q, 'linkedin', timing.minLlmMs, { tier: manyHolders ? 1 : undefined })),
      domainSearch,
    ]),
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

  // 2b) Roles many people hold: widen in tiers until there are enough credible people.
  let tiers = 1;
  let aliases: string[] = [];
  let variants: string[] = [];
  let languages: string[] = [];
  const triedTitles: string[] = [];
  if (manyHolders) {
    const titles = filterAndDedupe(hits).map((c) => c.title);
    aliases = [...new Set([...extractCompanyAliases(html, domain, company.name), ...brandFamilyNames(titles, company.name)])].slice(
      0,
      MAX_ALIASES,
    );
    variants = ruleVariants(position);
    const widened = (): RankingContext => ({ ...ctxBase, manyHolders: true, aliases, variants });
    if (credibleCount(filterAndDedupe(hits), widened()) < TARGET_MANY && deadline.remaining() >= timing.searchMs + timing.llmMs) {
      languages = pickLanguages(languagesFromHits(hits), languageFromHomepage(html));
      if (deps.llm && deadline.remaining() >= timing.searchMs + timing.llmMs + timing.minLlmMs) {
        const fromModel = await generateVariants(position, languages, deps.llm, {
          timeoutMs: deadline.budget(2500, timing.searchMs + timing.llmMs),
        });
        variants = [...new Set([...variants, ...fromModel])];
      }
      const tier2Titles = variants.slice(0, MAX_TIER2_VARIANTS);
      const tier2: string[] = [
        buildLooseQuery(company.name, position),
        ...tier2Titles.map((v) => buildNameQuery(company.name, v)),
        ...aliases.slice(0, 1).map((a) => buildNameQuery(a, position)),
      ].slice(0, Math.max(0, CREDIT_CAP_MANY - creditsUsed() - 2));
      triedTitles.push(...tier2Titles, ...aliases.slice(0, 1));
      const more = await Promise.allSettled(tier2.map((q) => runQuery(q, 'linkedin', timing.minLlmMs, { tier: 2 })));
      for (const outcome of more) if (outcome.status === 'fulfilled') hits.push(...outcome.value);
      tiers = 2;
      if (
        credibleCount(filterAndDedupe(hits), widened()) < TARGET_MANY &&
        creditsUsed() + 2 <= CREDIT_CAP_MANY &&
        deadline.remaining() >= timing.searchMs + timing.llmMs
      ) {
        const deep = await runQuery(nameQueries[0] ?? domainQuery, 'linkedin', timing.minLlmMs, { limit: DEEP_RESULTS, tier: 3 }).catch(
          () => [] as SearchHit[],
        );
        hits.push(...deep);
        tiers = 3;
      }
    }
  }
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
  const ctx: RankingContext = {
    ...ctxBase,
    ...(verify ? { evidence } : {}),
    ...(manyHolders ? { manyHolders: true, aliases, variants } : {}),
  };

  // The only profile with the holder's exact name, when nothing tied to the company was found.
  let nameOnlyProfile: Candidate | undefined;
  if (verifiedHolder) {
    const exact = filterAndDedupe(nameOnlyHits).filter((c) => exactSameName(parseLinkedInTitle(c.title).name, verifiedHolder.name));
    if (exact.length === 1 && otherEmployer(exact[0]!, ctx) === null) nameOnlyProfile = exact[0];
  }

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
    let decided = decideResults(results, candidates, verifiedHolder, ctx, {
      rankerReadProfiles: rankedBy === 'claude',
      manyHolders,
      likely,
      nameOnlyProfile,
    });
    // Nothing matched the exact title: the closest matches, clearly labelled, instead of nothing.
    if (decided.decision === 'no_results') {
      const closest = closestMatches(candidates, ctx);
      if (closest.length > 0) decided = { results: closest, verifiedHolder: null, decision: 'closest' };
    }
    trace.decision = decided.decision;
    trace.timings.totalMs = clock() - startedAt;
    trace.funnel = {
      candidates: candidates.length,
      credible: credibleCount(candidates, ctx),
      shown: decided.results.length,
      tiers,
      credits: creditsUsed(),
      variants: variants.length,
      aliases: aliases.length,
      languages,
    };
    return {
      ...base,
      results: decided.results,
      rankedBy,
      verifiedHolder: decided.verifiedHolder,
      ...(decided.decision === 'closest' ? { triedTitles: [...new Set(triedTitles)] } : {}),
    };
  };

  // 3) Rank — Claude if available and there's time, otherwise the heuristic. At most 2 model
  //    calls per search: no ranking retry when Claude already read the evidence.
  deps.onProgress?.('rank');
  if (candidates.length === 0) return finish([], deps.llm ? 'claude' : 'heuristic');

  const rankStarted = clock();
  if (manyHolders) {
    // The most relevant candidates first, so the model sees them within its limit.
    const relevant = new Set(rankHeuristically(candidates, ctx, { maxResults: candidates.length }).map((r) => r.linkedinUrl));
    const ordered = [...candidates.filter((c) => relevant.has(c.linkedinUrl)), ...candidates.filter((c) => !relevant.has(c.linkedinUrl))];
    if (deps.llm && deadline.remaining() >= timing.minLlmMs) {
      const llm = deps.llm;
      try {
        const results = await withTimeout('ranking', deadline.budget(timing.llmMs + 2000, 200), (signal) =>
          rankManyWithClaude(ordered, ctx, llm, {
            timeoutMs: deadline.budget(timing.llmMs + 2000, 200),
            maxResults: MAX_MANY_RESULTS,
            signal,
          }),
        );
        trace.timings.rankMs = clock() - rankStarted;
        return finish(results, 'claude');
      } catch (error) {
        log(`Claude ranking unavailable, using heuristic: ${errorText(error)}`);
      }
    }
    const results = rankHeuristically(candidates, ctx, { maxResults: MAX_MANY_RESULTS });
    trace.timings.rankMs = clock() - rankStarted;
    return finish(results, 'heuristic');
  }

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
