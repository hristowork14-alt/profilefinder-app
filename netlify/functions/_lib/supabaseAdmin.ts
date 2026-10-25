// Supabase client with the SECRET key. Server-side only: it bypasses Row Level Security,
// so every query below filters by the verified user id explicitly.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../src/types/database';
import { ConfigError, type FunctionEnv } from './env';

export type AdminClient = SupabaseClient<Database>;

let cached: { key: string; client: AdminClient } | null = null;

export function getSupabaseAdmin(env: FunctionEnv): AdminClient {
  if (!env.supabaseUrl || !env.supabaseSecretKey) {
    throw new ConfigError('SUPABASE_URL and SUPABASE_SECRET_KEY must be set for the functions.');
  }
  const key = `${env.supabaseUrl}|${env.supabaseSecretKey}`;
  if (cached?.key === key) return cached.client;

  const client = createClient<Database>(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-Client-Info': 'profilefinder-functions' } },
  });
  cached = { key, client };
  return client;
}

/** Abort signal for one database call. */
export const dbTimeout = (ms = 4000) => AbortSignal.timeout(ms);
