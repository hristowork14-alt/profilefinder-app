// Saves searches and their results to the user's history.
// The secret key bypasses RLS, so ownership is checked explicitly here.

import type { SaveSearchInput } from '../../../shared/records';
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
  return search.id;
}
