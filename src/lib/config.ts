// Frontend configuration. Only public values live here (they end up in the browser bundle).

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
export const SUPABASE_PUBLISHABLE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();

/** True when the real (non-demo) app has what it needs to talk to Supabase. */
export const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

/**
 * Google sign-in needs the Google provider configured in Supabase. Until it is, the button would
 * only produce an error, so the real app hides it unless VITE_GOOGLE_AUTH_ENABLED is "true".
 * The demo always shows it (it explains that Google works once Supabase is set up).
 */
export function showGoogleSignIn(demoMode: boolean, flag: string | undefined): boolean {
  return demoMode || (flag ?? '').trim() === 'true';
}

export const SHOW_GOOGLE_SIGN_IN = showGoogleSignIn(DEMO_MODE, import.meta.env.VITE_GOOGLE_AUTH_ENABLED);

/**
 * Cloudflare Turnstile site key for the human check on sign-up, log-in and reset requests.
 * Public by design (like the publishable key); the matching SECRET key lives only in Supabase.
 * Empty (local dev without a key) or demo mode = no human check.
 */
export const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim();
export const HUMAN_CHECK_ENABLED = !DEMO_MODE && TURNSTILE_SITE_KEY.length > 0;

export const FUNCTIONS_BASE = '/.netlify/functions';

export const MIN_PASSWORD_LENGTH = 8;
