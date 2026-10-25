// search_cache table access (service role only — the browser has no access to this table).

import { z } from 'zod';
import type { CacheRecord } from '../../../shared/records';
import type { RankedProfile } from '../../../shared/types';
import type { Json } from '../../../src/types/database';
import { dbTimeout, type AdminClient } from './supabaseAdmin';

const CachedResults = z.array(
  z.object({
    fullName: z.string(),
    headline: z.string(),
    linkedinUrl: z.string(),
    confidence: z.number(),
    reasoning: z.string(),
  }),
);

export async function getCached(
  admin: AdminClient,
  domain: string,
  positionNormalized: string,
  maxAgeMs: number,
): Promise<CacheRecord | null> {
  const since = new Date(Date.now() - maxAgeMs).toISOString();
  const { data, error } = await admin
    .from('search_cache')
    .select('domain, position_normalized, company_name, results, created_at')
    .eq('domain', domain)
    .eq('position_normalized', positionNormalized)
    .gte('created_at', since)
    .abortSignal(dbTimeout())
    .maybeSingle();
  if (error) throw new Error(`cache read: ${error.message}`);
  if (!data) return null;

  // Never trust stored JSON blindly — an invalid entry is treated as a miss.
  const results = CachedResults.safeParse(data.results);
  if (!results.success) return null;
  return {
    domain: data.domain,
    positionNormalized: data.position_normalized,
    companyName: data.company_name,
    results: results.data,
    createdAt: data.created_at,
  };
}

export async function putCached(
  admin: AdminClient,
  entry: { domain: string; positionNormalized: string; companyName: string; results: RankedProfile[] },
): Promise<void> {
  const { error } = await admin
    .from('search_cache')
    .upsert(
      {
        domain: entry.domain,
        position_normalized: entry.positionNormalized,
        company_name: entry.companyName,
        results: entry.results as unknown as Json,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'domain,position_normalized' },
    )
    .abortSignal(dbTimeout());
  if (error) throw new Error(`cache write: ${error.message}`);
}
