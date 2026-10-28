// How much a web page that names someone in a role is worth as evidence, and which pages are
// shown to the user as sources. Only search-result text and URLs are read; no page is fetched.
//
// Rules (generic — nothing here knows about any particular company or person):
//   • One website counts once, however many of its pages say the same thing.
//   • The company's own website counts double (it is the most authoritative source).
//   • Social networks, video and podcast platforms, forums and contact-data sites are "weak":
//     together they add at most one point and can never confirm someone on their own.
//   • Job ads and careers pages are never evidence of who holds a role.

import { normalizePosition } from './positionSynonyms';
import type { RankingContext, SourceLink } from './types';

export type SourceTier = 'official' | 'strong' | 'weak';

/** A search result that names the person in the role, with the sentence that does so. */
export interface SupportPage {
  url: string;
  title: string;
  /** The sentence (or title) from the search result that names the person in the role. */
  quote: string;
}

export interface Support {
  /** Weighted support used for the "is this confirmed?" threshold. */
  score: number;
  /** Distinct websites that support the claim (what the user is told). */
  sites: number;
  /** Distinct non-weak websites (the company's own site included). */
  strongSites: number;
  /** Up to MAX_LINKS links, one per website, strongest first, each with its quote. */
  links: SourceLink[];
}

const MAX_LINKS = 3;
const MAX_QUOTE = 200;
const MAX_TITLE = 200;

/** Hosting platforms where every subdomain is a different author. */
const SHARED_HOSTS = [
  'substack.com',
  'github.io',
  'medium.com',
  'blogspot.com',
  'wordpress.com',
  'tumblr.com',
  'wixsite.com',
  'netlify.app',
  'vercel.app',
  'pages.dev',
];
/** Second-level labels of country domains like .co.uk or .com.au. */
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ltd', 'plc', 'me', 'or', 'ne', 'go', 'gob', 'nic', 'mil']);

/** Social networks, video and podcast platforms, Q&A sites. */
const SOCIAL_HOSTS = [
  'facebook.com',
  'fb.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'threads.net',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'vimeo.com',
  'reddit.com',
  'quora.com',
  'pinterest.com',
  'spotify.com',
  'podcasts.apple.com',
  'music.apple.com',
  'soundcloud.com',
  'linkedin.com',
];
/** Sites that sell or scrape contact and company data (often copied from LinkedIn headlines). */
const DATA_HOSTS = [
  'rocketreach.co',
  'zoominfo.com',
  'signalhire.com',
  'contactout.com',
  'apollo.io',
  'lusha.com',
  'clay.com',
  'derrick-app.com',
  'theorg.com',
  'crunchbase.com',
  'pitchbook.com',
  'cbinsights.com',
  'craft.co',
  'owler.com',
  'leadiq.com',
  'datanyze.com',
  'cognism.com',
  'kaspr.io',
  'salesql.com',
  'getprospect.com',
  'wiza.co',
  'uplead.com',
  'seedtable.com',
  'adapt.io',
  'rocketreach.com',
];
const JOB_HOSTS = [
  'greenhouse.io',
  'lever.co',
  'workable.com',
  'ashbyhq.com',
  'smartrecruiters.com',
  'myworkdayjobs.com',
  'indeed.com',
  'glassdoor.com',
  'jobs.ch',
  'stepstone.de',
  'welcometothejungle.com',
];

const FORUM_PATH = /\/(?:forums?|discussions?|community|threads?|boards?)(?:\/|$)/i;
const DATA_TITLE = /\bemail\b[^|]{0,20}\bphone\b|\bphone number\b|\bemail address\b|\bcontact (?:info|information|details)\b/i;
const JOB_PATH =
  /\/(?:careers?|jobs?|job-openings?|vacanc(?:y|ies)|openings?|apply|recruit(?:ing|ment)?|stellenangebote|karriere)(?:\/|$|-[\w-]*\d)/i;
const JOB_SUBDOMAIN = /^(?:jobs|careers|career|apply|recruiting)\./i;

const TRACKING_PARAMS = /^(?:utm_\w+|srsltid|gclid|fbclid|msclkid|mc_cid|mc_eid|igshid|ref_src|_hsenc|_hsmi)$/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

function onHost(host: string, list: string[]): boolean {
  return list.some((h) => host === h || host.endsWith(`.${h}`));
}

/** The website a host belongs to: "ir.northwind.com" → "northwind.com", "a.co.uk" stays whole. */
export function siteOf(host: string): string {
  const clean = host.toLowerCase().replace(/^www\./, '');
  const shared = SHARED_HOSTS.find((h) => clean.endsWith(`.${h}`));
  const labels = clean.split('.').filter(Boolean);
  if (shared) return labels.slice(-(shared.split('.').length + 1)).join('.');
  if (labels.length >= 3 && labels[labels.length - 1]!.length === 2 && SECOND_LEVEL.has(labels[labels.length - 2]!)) {
    return labels.slice(-3).join('.');
  }
  return labels.slice(-2).join('.');
}

/** A page on the company's own website (e.g. ir.orbitly.com for orbitly.com). */
export function isOfficialHost(host: string, domain: string): boolean {
  const d = domain.toLowerCase();
  const h = host.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

/** Removes tracking parameters and the #fragment, so links are clean and comparable. */
export function cleanSourceUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) parsed.searchParams.delete(key);
  }
  parsed.hash = '';
  return parsed.toString();
}

/** Job ads and careers pages: they describe an opening, not who holds the role. */
export function isJobPage(url: string, _title: string): boolean {
  const host = hostOf(url);
  return onHost(host, JOB_HOSTS) || JOB_SUBDOMAIN.test(host) || JOB_PATH.test(pathOf(url));
}

/** Social, video, podcast, forum and contact-data pages. */
export function isWeakSource(url: string, title: string): boolean {
  const host = hostOf(url);
  return onHost(host, SOCIAL_HOSTS) || onHost(host, DATA_HOSTS) || FORUM_PATH.test(pathOf(url)) || DATA_TITLE.test(title);
}

export function sourceTier(url: string, title: string, domain: string): SourceTier {
  const host = hostOf(url);
  if (host && isOfficialHost(host, domain)) return 'official';
  return isWeakSource(url, title) ? 'weak' : 'strong';
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function hasPhrase(text: string, phrase: string): boolean {
  const p = normalizePosition(phrase);
  return p.length >= 2 && ` ${normalizePosition(text)} `.includes(` ${p} `);
}

/** True when the text names the company: its name, its website, or the website's name part. */
export function mentionsCompany(text: string, ctx: Pick<RankingContext, 'companyName' | 'domain'>): boolean {
  const folded = fold(text);
  const domain = ctx.domain.toLowerCase();
  if (domain && folded.includes(domain)) return true;
  if (hasPhrase(folded, ctx.companyName)) return true;
  const label = domain.split('.')[0] ?? '';
  return label.length >= 3 && hasPhrase(folded, label);
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** Combines the pages that name someone into one support figure and the links to show. */
export function summarizeSupport(pages: SupportPage[], domain: string): Support {
  const bySite = new Map<string, { page: SupportPage; tier: SourceTier }>();
  for (const page of pages) {
    const host = hostOf(page.url);
    if (!host) continue;
    const site = siteOf(host);
    const tier = sourceTier(page.url, page.title, domain);
    const existing = bySite.get(site);
    if (!existing) bySite.set(site, { page, tier });
  }

  const entries = [...bySite.values()];
  const official = entries.filter((e) => e.tier === 'official');
  const strong = entries.filter((e) => e.tier === 'strong');
  const weak = entries.filter((e) => e.tier === 'weak');

  const toLink = ({ page }: { page: SupportPage }): SourceLink => ({
    title: truncate(page.title, MAX_TITLE),
    url: cleanSourceUrl(page.url),
    quote: truncate(page.quote, MAX_QUOTE),
  });
  const better = [...official, ...strong].slice(0, MAX_LINKS).map(toLink);
  // Weak sources are shown only to fill in when there is little else.
  const links = better.length >= 2 ? better : [...better, ...weak.slice(0, 2 - better.length).map(toLink)];

  return {
    score: (official.length > 0 ? 2 : 0) + strong.length + Math.min(1, weak.length),
    sites: entries.length,
    strongSites: official.length + strong.length,
    links,
  };
}
