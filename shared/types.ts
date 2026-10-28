// Types shared by the Netlify Functions, the browser demo and the tests.
// Everything in /shared is plain TypeScript with no Node- or browser-only APIs.

/** One organic result from a web search API. */
export interface SearchHit {
  title: string;
  snippet: string;
  url: string;
}

/** A search hit that passed the LinkedIn-profile filter, with a normalized URL. */
export interface Candidate {
  title: string;
  snippet: string;
  /** Always https://www.linkedin.com/in/<slug> */
  linkedinUrl: string;
  /** Lowercase, decoded slug used for de-duplication. */
  slug: string;
  /** How many independent (non-LinkedIn) sources name this person in the role. Only set when corroboration ran. */
  corroboratedBy?: number;
  /** Returned by a search for the verified person's name together with the company name. */
  foundWithCompany?: boolean;
}

/** One ranked profile, as shown to the user. */
export interface RankedProfile {
  fullName: string;
  headline: string;
  linkedinUrl: string;
  /** 0–100 */
  confidence: number;
  /** One sentence */
  reasoning: string;
  /** True when independent sources name this person in the role. Only set when verification ran. */
  verified?: boolean;
}

/** A search-result page that names the holder (title + URL only; never fetched). */
export interface SourceLink {
  title: string;
  url: string;
  /** The sentence from the search result that names the person in the role (absent on older searches). */
  quote?: string;
}

/** The person independent (non-LinkedIn) sources name as holding the role. */
export interface VerifiedHolder {
  name: string;
  /** Distinct websites that name this person in the role (older searches: a weighted count). */
  sources: number;
  /** Up to 3, one per website, the company's own site first. */
  sourceLinks: SourceLink[];
}

export interface RankingContext {
  companyName: string;
  domain: string;
  position: string;
  synonyms: string[];
  /** People that independent web sources name as holding the role (empty or absent = no evidence). */
  evidence?: { name: string; sources: number }[];
}

export type RankedBy = 'claude' | 'heuristic';
export type CompanyNameSource = 'og:site_name' | 'title' | 'domain';
export type PipelineStep = 'company' | 'search' | 'rank';

export interface SearchOptions {
  signal: AbortSignal;
  /** How many results to ask for. */
  limit: number;
}

/** A web search API (Serper, Brave, …). Swappable through SEARCH_PROVIDER. */
export interface SearchProvider {
  name: string;
  search(query: string, options: SearchOptions): Promise<SearchHit[]>;
}

export interface LlmRequest {
  system: string;
  prompt: string;
  maxTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Anything that turns a prompt into text: the real Claude client or the mock. */
export interface LlmClient {
  complete(request: LlmRequest): Promise<string>;
}

/** Returns the homepage HTML for a domain, or throws. */
export type HomepageFetcher = (domain: string, signal: AbortSignal) => Promise<string>;

/** What the search endpoint returns to the browser. */
export interface SearchResponse {
  searchId: string | null;
  companyName: string;
  domain: string;
  position: string;
  results: RankedProfile[];
  fromCache: boolean;
  rankedBy: RankedBy | 'cache';
  message: string | null;
  /**
   * Only present when verification ran (real app): the verified holder, or null when no one could
   * be confirmed. Absent in the demo.
   */
  verifiedHolder?: VerifiedHolder | null;
  /**
   * Only present when verification ran: how the answer was reached ('contradicted' = the sources
   * and the LinkedIn profile disagree).
   */
  decision?: 'verified_profile' | 'verified_no_profile' | 'contradicted' | 'unverified' | 'no_results' | null;
}

/** Error body returned by the search endpoint. */
export interface ApiErrorBody {
  error: string;
  code: 'invalid_input' | 'unauthorized' | 'rate_limited' | 'search_failed' | 'not_configured' | 'method_not_allowed' | 'server_error';
}
