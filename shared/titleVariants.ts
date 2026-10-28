// Other ways a job title is written in LinkedIn headlines, so a search for one form also finds
// the others: "Mechanical Engineer" ↔ "Mechanical Engineering", "Mechanical Design Engineer",
// "Ingénieur mécanique" … Generic rules come first (free, instant); Claude adds synonyms and
// translations into the languages the company's people use. Nothing here is specific to any
// company; the languages come from where the company's profiles are (LinkedIn country sites)
// and from its homepage.

import { z } from 'zod';
import { normalizePosition } from './positionSynonyms';
import type { LlmClient, SearchHit } from './types';

const MAX_VARIANTS = 8;
const MAX_VARIANT_LENGTH = 60;
const MAX_LANGUAGES = 2;
const MAX_OUTPUT_TOKENS = 250;

/** Leading words that only say how senior someone is. */
const SENIORITY = new Set([
  'senior',
  'sr',
  'junior',
  'jr',
  'lead',
  'principal',
  'staff',
  'associate',
  'trainee',
  'entry-level',
  'graduate',
]);

/** Role noun → the field it works in (as headlines often say "Mechanical Engineering at …"). */
const FIELD_FORM: Record<string, string> = {
  engineer: 'Engineering',
  developer: 'Development',
  designer: 'Design',
  analyst: 'Analytics',
  manager: 'Management',
  accountant: 'Accounting',
  recruiter: 'Recruitment',
  scientist: 'Science',
  marketer: 'Marketing',
  consultant: 'Consulting',
  architect: 'Architecture',
};

/** LinkedIn country sites (xx.linkedin.com) → the main language there. English-speaking ones are left out. */
const COUNTRY_LANGUAGE: Record<string, string> = {
  fr: 'fr',
  be: 'fr',
  ma: 'fr',
  de: 'de',
  at: 'de',
  ch: 'de',
  hr: 'hr',
  es: 'es',
  mx: 'es',
  ar: 'es',
  co: 'es',
  cl: 'es',
  pe: 'es',
  it: 'it',
  bg: 'bg',
  nl: 'nl',
  pt: 'pt',
  br: 'pt',
  pl: 'pl',
  se: 'sv',
  dk: 'da',
  no: 'no',
  fi: 'fi',
  cz: 'cs',
  sk: 'sk',
  ro: 'ro',
  hu: 'hu',
  gr: 'el',
  tr: 'tr',
  rs: 'sr',
  si: 'sl',
  ru: 'ru',
  ua: 'uk',
  jp: 'ja',
  kr: 'ko',
  cn: 'zh',
  tw: 'zh',
  il: 'he',
  ae: 'ar',
  sa: 'ar',
  id: 'id',
  th: 'th',
  vn: 'vi',
  lt: 'lt',
  lv: 'lv',
  ee: 'et',
};

const LANGUAGE_NAME: Record<string, string> = {
  fr: 'French',
  de: 'German',
  hr: 'Croatian',
  es: 'Spanish',
  it: 'Italian',
  bg: 'Bulgarian',
  nl: 'Dutch',
  pt: 'Portuguese',
  pl: 'Polish',
  sv: 'Swedish',
  da: 'Danish',
  no: 'Norwegian',
  fi: 'Finnish',
  cs: 'Czech',
  sk: 'Slovak',
  ro: 'Romanian',
  hu: 'Hungarian',
  el: 'Greek',
  tr: 'Turkish',
  sr: 'Serbian',
  sl: 'Slovenian',
  ru: 'Russian',
  uk: 'Ukrainian',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  he: 'Hebrew',
  ar: 'Arabic',
  id: 'Indonesian',
  th: 'Thai',
  vi: 'Vietnamese',
  lt: 'Lithuanian',
  lv: 'Latvian',
  et: 'Estonian',
};

const capitalize = (word: string) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word);

/** Free, rule-based variants of a title (never the title itself). */
export function ruleVariants(position: string): string[] {
  const words = position.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];

  let core = words;
  while (core.length > 0 && SENIORITY.has(core[0]!.toLowerCase().replace(/\.$/, ''))) core = core.slice(1);
  if (core.length >= 2 && core.length < words.length) out.push(core.join(' '));

  const last = core[core.length - 1]?.toLowerCase() ?? '';
  const field = FIELD_FORM[last];
  if (core.length >= 2 && field) out.push([...core.slice(0, -1), field].join(' '));
  if (core.length >= 2 && last === 'engineer' && !core.some((w) => w.toLowerCase() === 'design')) {
    out.push([...core.slice(0, -1), 'Design', capitalize(core[core.length - 1]!)].join(' '));
  }

  const own = normalizePosition(position);
  const seen = new Set<string>([own]);
  return out.filter((variant) => {
    const key = normalizePosition(variant);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Languages (other than English) of the LinkedIn country sites the profiles came from, most common first. */
export function languagesFromHits(hits: SearchHit[]): string[] {
  const counts = new Map<string, number>();
  for (const hit of hits) {
    let host: string;
    try {
      host = new URL(hit.url).hostname.toLowerCase();
    } catch {
      continue;
    }
    const match = /^([a-z]{2})\.linkedin\.com$/.exec(host);
    const language = match ? COUNTRY_LANGUAGE[match[1]!] : undefined;
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([language]) => language)
    .slice(0, MAX_LANGUAGES);
}

/** The homepage's declared language (<html lang>), unless it is English. */
export function languageFromHomepage(html: string | null): string | null {
  if (!html) return null;
  const lang = /<html\b[^>]*\blang\s*=\s*["']?([a-zA-Z]{2,3})/i.exec(html)?.[1]?.toLowerCase() ?? null;
  return lang && lang !== 'en' && LANGUAGE_NAME[lang] ? lang : null;
}

/** Unique languages, most relevant first, at most two. */
export function pickLanguages(...lists: (string | null | string[])[]): string[] {
  const out: string[] = [];
  for (const item of lists.flat()) if (item && LANGUAGE_NAME[item] && !out.includes(item)) out.push(item);
  return out.slice(0, MAX_LANGUAGES);
}

const SYSTEM_PROMPT = `You list the ways people write one job title in their LinkedIn headline.

Rules:
- Same role only: common English alternatives, the field form ("Mechanical Engineering"), common specialisations, and the usual translations into the requested languages.
- Never a broader or different role, never a company name, no seniority-only changes.
- Each item is a plain title of at most 6 words. No quotes, no punctuation other than "-" or "&".
- At most ${MAX_VARIANTS} items.

Reply with JSON only, exactly in this shape:
{"variants":["...","..."]}`;

export function buildVariantPrompt(position: string, languages: string[]): { system: string; prompt: string } {
  const names = languages.map((l) => LANGUAGE_NAME[l]).filter(Boolean);
  const prompt = [
    `Job title: ${position}`,
    `Translate into: ${names.length ? names.join(', ') : 'none (English alternatives only)'}`,
    '',
    'Return the JSON now.',
  ].join('\n');
  return { system: SYSTEM_PROMPT, prompt };
}

const VariantReply = z.object({ variants: z.array(z.string()).max(20) });
/** Characters and words that could change what a search does. */
const UNSAFE = /["'“”„:()|*<>\\[\]{}]|\b(?:OR|AND|site)\b/;

export function parseVariants(text: string, position: string): string[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const parsed = VariantReply.safeParse(data);
  if (!parsed.success) return [];
  const seen = new Set<string>([normalizePosition(position)]);
  const out: string[] = [];
  for (const raw of parsed.data.variants) {
    const variant = raw.replace(/\s+/g, ' ').trim();
    const key = normalizePosition(variant);
    if (variant.length < 3 || variant.length > MAX_VARIANT_LENGTH || UNSAFE.test(variant) || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(variant);
    if (out.length >= MAX_VARIANTS) break;
  }
  return out;
}

const cache = new Map<string, string[]>();
const MAX_CACHE = 500;

/** For tests. */
export function clearVariantCache(): void {
  cache.clear();
}

/**
 * Claude's variants and translations of a title. Cached per title and languages for the life of
 * the function instance. Never throws: on any model error the search goes on without them.
 */
export async function generateVariants(
  position: string,
  languages: string[],
  llm: LlmClient,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<string[]> {
  const key = `${normalizePosition(position)}|${[...languages].sort().join(',')}`;
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const { system, prompt } = buildVariantPrompt(position, languages);
    const text = await llm.complete({ system, prompt, maxTokens: MAX_OUTPUT_TOKENS, timeoutMs: options.timeoutMs, signal: options.signal });
    const variants = parseVariants(text, position);
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value ?? '');
    cache.set(key, variants);
    return variants;
  } catch {
    return [];
  }
}
