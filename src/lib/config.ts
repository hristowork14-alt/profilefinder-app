// Frontend configuration. Only public values live here (they end up in the browser bundle).

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
export const SUPABASE_PUBLISHABLE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();

/** True when the real (non-demo) app has what it needs to talk to Supabase. */
export const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

export const FUNCTIONS_BASE = '/.netlify/functions';

export const MIN_PASSWORD_LENGTH = 8;
