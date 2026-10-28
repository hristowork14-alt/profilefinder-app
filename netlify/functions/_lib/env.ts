// Reads function configuration from environment variables (set in Netlify → Site
// configuration → Environment variables, or in .env for `netlify dev`).

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface FunctionEnv {
  supabaseUrl: string;
  supabaseSecretKey: string;
  searchProvider: string;
  serperApiKey: string;
  anthropicApiKey: string;
  anthropicModel: string;
  /** 'low' by default; null = don't send the effort setting at all. */
  anthropicEffort: 'low' | 'medium' | 'high' | null;
  maxSearchesPerHour: number;
  maxSearchesPerDay: number;
  useMocks: boolean;
}

export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5';
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Cached results written before this moment are ignored: they came from an older pipeline (last
 * bump: sources must be about this company, one website counts once, conflicts and roles many
 * people hold are labelled).
 * Bump this whenever the way results are found or ranked changes.
 */
export const CACHE_VALID_AFTER = Date.parse('2026-10-28T09:00:00Z');

type EnvSource = Record<string, string | undefined>;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : fallback;
}

function readEffort(value: string | undefined): FunctionEnv['anthropicEffort'] {
  const effort = (value ?? '').trim().toLowerCase();
  if (effort === 'default' || effort === 'none') return null;
  return effort === 'medium' || effort === 'high' ? effort : 'low';
}

export function readEnv(source: EnvSource = process.env): FunctionEnv {
  return {
    supabaseUrl: (source.SUPABASE_URL ?? '').trim(),
    supabaseSecretKey: (source.SUPABASE_SECRET_KEY ?? '').trim(),
    searchProvider: (source.SEARCH_PROVIDER ?? 'serper').trim().toLowerCase() || 'serper',
    serperApiKey: (source.SERPER_API_KEY ?? '').trim(),
    anthropicApiKey: (source.ANTHROPIC_API_KEY ?? '').trim(),
    anthropicModel: (source.ANTHROPIC_MODEL ?? '').trim() || DEFAULT_ANTHROPIC_MODEL,
    anthropicEffort: readEffort(source.ANTHROPIC_EFFORT),
    maxSearchesPerHour: positiveInt(source.MAX_SEARCHES_PER_HOUR, 30),
    maxSearchesPerDay: positiveInt(source.MAX_SEARCHES_PER_DAY, 200),
    useMocks: /^(1|true|yes)$/i.test((source.USE_MOCKS ?? '').trim()),
  };
}
