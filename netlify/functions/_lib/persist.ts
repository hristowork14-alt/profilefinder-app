// Saves searches and their results to the user's history.
// The secret key bypasses RLS, so ownership is checked explicitly here.

import type { PipelineTrace } from '../../../shared/pipeline';
import type { SaveSearchInput } from '../../../shared/records';
import type { Json } from '../../../src/types/database';
import { dbTimeout, type AdminClient } from './supabaseAdmin';

const trim = (value: string | null, max: number) => (value == null ? null : value.slice(0, max));

export async function userOwnsBulkJob(admin: AdminClient, userId: string, bulkJobId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('bulk_jobs')
    .select('id')
    .eq('id', bulkJobId)
    .eq('user_id', userId)
    .abortSignal(dbTimeout())
    .maybeSingle();
  if (error) throw new Error(`bulk job lookup: ${error.message}`);
  return Boolean(data);
}

export async function saveSearch(admin: AdminClient, input: SaveSearchInput): Promise<string> {
  const { data: search, error } = await admin
    .from('searches')
    .insert({
      user_id: input.userId,
      bulk_job_id: input.bulkJobId,
      company_url: input.companyUrl.slice(0, 500),
      domain: trim(input.domain, 253),
      company_name: trim(input.companyName, 200),
      position: input.position.slice(0, 100),
      status: input.status,
      error: trim(input.error, 500),
      from_cache: input.fromCache,
      ...(input.verifiedHolder
        ? {
            verified_holder: input.verifiedHolder.name.slice(0, 200),
            verified_sources: Math.max(0, Math.min(100, Math.round(input.verifiedHolder.sources))),
            verified_source_links: input.verifiedHolder.sourceLinks.slice(0, 3) as unknown as Json,
          }
        : {}),
    })
    .select('id')
    .abortSignal(dbTimeout())
    .single();
  if (error || !search) throw new Error(`search insert: ${error?.message ?? 'no row returned'}`);

  if (input.results.length > 0) {
    const { error: resultsError } = await admin
      .from('search_results')
      .insert(
        input.results.slice(0, 5).map((result, index) => ({
          search_id: search.id,
          rank: index + 1,
          full_name: result.fullName.slice(0, 200),
          headline: result.headline.slice(0, 300),
          linkedin_url: result.linkedinUrl,
          confidence: Math.max(0, Math.min(100, Math.round(result.confidence))),
          reasoning: result.reasoning.slice(0, 500),
          verified: result.verified === true,
        })),
      )
      .abortSignal(dbTimeout());
    if (resultsError) {
      // Keep history consistent: a search without its results is marked failed.
      await admin
        .from('searches')
        .update({ status: 'failed', error: 'Results could not be saved.' })
        .eq('id', search.id)
        .abortSignal(dbTimeout());
      throw new Error(`results insert: ${resultsError.message}`);
    }
  }

  if (input.diagnostics) await saveDiagnostics(admin, search.id, input.diagnostics);
  return search.id;
}

/**
 * Server-only debugging record (RLS on, no client policies). Best-effort: a failure here is
 * logged but never fails the search. Contains query texts, counts, timings, the decision and
 * evidence names with source hosts — never snippets.
 */
async function saveDiagnostics(admin: AdminClient, searchId: string, trace: PipelineTrace): Promise<void> {
  const { error } = await admin
    .from('search_diagnostics')
    .insert({
      search_id: searchId,
      queries: trace.queries.slice(0, 20) as unknown as Json,
      evidence: trace.evidence.slice(0, 5) as unknown as Json,
      decision: trace.decision,
      extraction: trace.extraction,
      timings: trace.timings as unknown as Json,
    })
    .abortSignal(dbTimeout());
  if (error) console.log(`[profilefinder] Diagnostics insert failed: ${error.message}`);
}
