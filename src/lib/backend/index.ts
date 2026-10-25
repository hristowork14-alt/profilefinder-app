import { DEMO_MODE, SUPABASE_CONFIGURED } from '../config';
import { createDemoBackend } from './demoBackend';
import { createSupabaseBackend } from './supabaseBackend';
import type { Backend } from './types';

let backend: Backend | null = null;

/** The demo backend in demo mode, otherwise the real Supabase backend (null if not configured yet). */
export function getBackend(): Backend | null {
  if (backend) return backend;
  if (DEMO_MODE) backend = createDemoBackend();
  else if (SUPABASE_CONFIGURED) backend = createSupabaseBackend();
  return backend;
}

export function requireBackend(): Backend {
  const current = getBackend();
  if (!current) throw new Error('The app is not configured yet. Set the Supabase environment variables (see README).');
  return current;
}

export type { Backend } from './types';
