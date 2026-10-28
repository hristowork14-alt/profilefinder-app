// search_cache table access (service role only — the browser has no access to this table).

import { z } from 'zod';
import { DECISIONS, type Decision } from '../../../shared/decision';
import type { CacheRecord } from '../../../shared/records';
import type { RankedProfile, VerifiedHolder } from '../../../shared/types';
import type { Json } from '../../../src/types/database';
import { dbTimeout, type AdminClient } from './supabaseAdmin';

const CachedResults = z.array(
  z.object({
    fullName: z.string(),
    headline: z.string(),
    linkedinUrl: z.string(),
    confidence: z.number(),
    reasoning: z.string(),
    verified: z.boolean().optional(),
  }),
);

const CachedHolder = z.object({
  name: z.string().min(1).max(200),
  role: z.string().max(120).optional(),
  sources: z.number(),
  sourceLinks: z.array(z.object({ title: z.string(), url: z.string(), quote: z.string().max(300).optional() })).max(3),
});

const CachedDecision = z.enum(DECISIONS);

export async function getCached(
  admin: AdminClient,
  domain: string,
  positionNormalized: string,
  maxAgeMs: number,
): Promise<CacheRecord | null> {
  const since = new Date(Date.now() - maxAgeMs).toISOString();
  const { data, error } = await admin
    .from('search_cache')
    .select('domain, position_normalized, company_name, results, created_at, verified_holder, decision')
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
  const record: CacheRecord = {
    domain: data.domain,
    positionNormalized: data.position_normalized,
    companyName: data.company_name,
    results: results.data,
    createdAt: data.created_at,
  };
  if (data.verified_holder !== null && data.verified_holder !== undefined) {
    const holder = CachedHolder.safeParse(data.verified_holder);
    if (!holder.success) return null;
    record.verifiedHolder = holder.data;
  }
  const decision = CachedDecision.safeParse(data.decision);
  if (decision.success) record.decision = decision.data;
  return record;
}

export async function putCached(
  admin: AdminClient,
  entry: {
    domain: string;
    positionNormalized: string;
    companyName: string;
    results: RankedProfile[];
    verifiedHolder?: VerifiedHolder | null;
    decision?: Decision | null;
  },
): Promise<void> {
  const { error } = await admin
    .from('search_cache')
    .upsert(
      {
        domain: entry.domain,
        position_normalized: entry.positionNormalized,
        company_name: entry.companyName,
        results: entry.results as unknown as Json,
        verified_holder: (entry.verifiedHolder ?? null) as unknown as Json,
        decision: entry.decision ?? null,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'domain,position_normalized' },
    )
    .abortSignal(dbTimeout());
  if (error) throw new Error(`cache write: ${error.message}`);
}
