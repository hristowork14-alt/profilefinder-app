// Real backend: Supabase Auth + Postgres (protected by RLS) + Netlify Functions.

import type { BulkJobRecord, BulkRowRecord, SearchRecord, SearchWithResults } from '@shared/records';
import type { RankedProfile } from '@shared/types';
import type { BulkJobRow, BulkJobRowRow, SearchResultRow, SearchRow } from '@/types/database';
import { ApiError, deleteAccountRequest, searchRequest } from '../api';
import { getSupabase } from '../supabaseClient';
import type { AuthEvent, AuthUser, Backend } from './types';

const appUrl = (path: string) => `${window.location.origin}${path}`;

function toUser(user: { id: string; email?: string | null } | null | undefined): AuthUser | null {
  return user ? { id: user.id, email: user.email ?? '' } : null;
}

function mapSearch(row: SearchRow, resultCount: number): SearchRecord {
  return {
    id: row.id,
    userId: row.user_id,
    bulkJobId: row.bulk_job_id,
    companyUrl: row.company_url,
    domain: row.domain,
    companyName: row.company_name,
    position: row.position,
    status: row.status,
    error: row.error,
    fromCache: row.from_cache,
    createdAt: row.created_at,
    resultCount,
  };
}

function mapResult(row: SearchResultRow): RankedProfile {
  return {
    fullName: row.full_name,
    headline: row.headline,
    linkedinUrl: row.linkedin_url,
    confidence: row.confidence,
    reasoning: row.reasoning,
  };
}

function mapJob(row: BulkJobRow): BulkJobRecord {
  return {
    id: row.id,
    userId: row.user_id,
    fileName: row.file_name,
    totalRows: row.total_rows,
    processedRows: row.processed_rows,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRow(row: BulkJobRowRow): BulkRowRecord {
  return {
    id: row.id,
    bulkJobId: row.bulk_job_id,
    rowIndex: row.row_index,
    companyUrl: row.company_url,
    position: row.position,
    status: row.status,
    searchId: row.search_id,
    error: row.error,
  };
}

/** Turns a Supabase error into a readable one. */
function fail(action: string, error: { message: string } | null): never {
  throw new Error(`Could not ${action}. ${error?.message ? `(${error.message})` : 'Please try again.'}`);
}

async function requireUserId(): Promise<string> {
  const { data } = await getSupabase().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new ApiError(401, 'Your session has expired. Please log in again.', 'unauthorized');
  return id;
}

async function accessToken(): Promise<string> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, 'Your session has expired. Please log in again.', 'unauthorized');
  return token;
}

export function createSupabaseBackend(): Backend {
  const supabase = getSupabase();

  return {
    mode: 'supabase',

    auth: {
      async getUser() {
        const { data } = await supabase.auth.getSession();
        return toUser(data.session?.user);
      },
      onChange(callback) {
        const { data } = supabase.auth.onAuthStateChange((event, session) => {
          const mapped: AuthEvent =
            event === 'PASSWORD_RECOVERY'
              ? 'PASSWORD_RECOVERY'
              : event === 'SIGNED_OUT'
                ? 'SIGNED_OUT'
                : event === 'USER_UPDATED'
                  ? 'USER_UPDATED'
                  : event === 'INITIAL_SESSION'
                    ? 'INITIAL'
                    : 'SIGNED_IN';
          callback(toUser(session?.user), mapped);
        });
        return () => data.subscription.unsubscribe();
      },
      async signUp(email, password) {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: appUrl('/app') } });
        if (error) throw new Error(error.message);
        return { needsConfirmation: !data.session };
      },
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
      },
      async signInWithGoogle() {
        const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl('/app') } });
        if (error) throw new Error(error.message);
      },
      async signOut() {
        const { error } = await supabase.auth.signOut();
        if (error) throw new Error(error.message);
      },
      async requestPasswordReset(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: appUrl('/reset-password') });
        if (error) throw new Error(error.message);
      },
      async updatePassword(newPassword) {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw new Error(error.message);
      },
      async deleteAccount() {
        await deleteAccountRequest(await accessToken());
        await supabase.auth.signOut().catch(() => undefined);
      },
    },

    async search(input, options) {
      return searchRequest(await accessToken(), input, options?.signal);
    },

    history: {
      async list() {
        const { data, error } = await supabase
          .from('searches')
          .select('*, search_results(count)')
          .order('created_at', { ascending: false })
          .limit(200);
        if (error) fail('load your history', error);
        return (data ?? []).map((row) => {
          const { search_results: counts, ...search } = row;
          const count = Array.isArray(counts) ? ((counts[0] as { count?: number } | undefined)?.count ?? 0) : 0;
          return mapSearch(search as SearchRow, count);
        });
      },
      async get(searchId) {
        const { data, error } = await supabase.from('searches').select('*, search_results(*)').eq('id', searchId).maybeSingle();
        if (error) fail('load this search', error);
        if (!data) return null;
        const { search_results: results, ...search } = data;
        const sorted = [...((results ?? []) as SearchResultRow[])].sort((a, b) => a.rank - b.rank).map(mapResult);
        const record: SearchWithResults = { ...mapSearch(search as SearchRow, sorted.length), results: sorted };
        return record;
      },
      async remove(searchId) {
        const { error } = await supabase.from('searches').delete().eq('id', searchId);
        if (error) fail('delete the search', error);
      },
      async removeAll() {
        const userId = await requireUserId();
        const { error } = await supabase.from('searches').delete().eq('user_id', userId);
        if (error) fail('delete your history', error);
        const { error: jobsError } = await supabase.from('bulk_jobs').delete().eq('user_id', userId);
        if (jobsError) fail('delete your bulk jobs', jobsError);
      },
    },

    bulk: {
      async createJob(fileName, rows) {
        const { data: job, error } = await supabase
          .from('bulk_jobs')
          .insert({ file_name: fileName.slice(0, 255) || 'upload.csv', total_rows: rows.length, status: 'pending' })
          .select('*')
          .single();
        if (error || !job) fail('create the bulk job', error);

        const { error: rowsError } = await supabase.from('bulk_job_rows').insert(
          rows.map((row, index) => ({
            bulk_job_id: job.id,
            row_index: index,
            company_url: row.companyUrl.slice(0, 500),
            position: row.position.slice(0, 200),
            status: row.error ? ('failed' as const) : ('pending' as const),
            error: row.error,
          })),
        );
        if (rowsError) {
          await supabase.from('bulk_jobs').delete().eq('id', job.id);
          fail('save the CSV rows', rowsError);
        }
        const { data: processed, error: progressError } = await supabase.rpc('refresh_bulk_job_progress', { p_job_id: job.id });
        if (progressError) fail('update progress', progressError);
        return { ...mapJob(job), processedRows: typeof processed === 'number' ? processed : 0 };
      },
      async listJobs() {
        const { data, error } = await supabase.from('bulk_jobs').select('*').order('created_at', { ascending: false }).limit(20);
        if (error) fail('load your bulk jobs', error);
        return (data ?? []).map(mapJob);
      },
      async getJob(jobId) {
        const { data, error } = await supabase.from('bulk_jobs').select('*').eq('id', jobId).maybeSingle();
        if (error) fail('load the bulk job', error);
        return data ? mapJob(data) : null;
      },
      async listRows(jobId) {
        const { data, error } = await supabase.from('bulk_job_rows').select('*').eq('bulk_job_id', jobId).order('row_index');
        if (error) fail('load the bulk job rows', error);
        return (data ?? []).map(mapRow);
      },
      async updateRow(rowId, patch) {
        const { error } = await supabase
          .from('bulk_job_rows')
          .update({
            ...(patch.status ? { status: patch.status } : {}),
            ...(patch.searchId !== undefined ? { search_id: patch.searchId } : {}),
            ...(patch.error !== undefined ? { error: patch.error?.slice(0, 500) ?? null } : {}),
          })
          .eq('id', rowId);
        if (error) fail('update a bulk row', error);
      },
      async refreshProgress(jobId) {
        const { data, error } = await supabase.rpc('refresh_bulk_job_progress', { p_job_id: jobId });
        if (error) fail('update progress', error);
        return typeof data === 'number' ? data : 0;
      },
      async setJobStatus(jobId, status) {
        const { error } = await supabase.from('bulk_jobs').update({ status }).eq('id', jobId);
        if (error) fail('update the bulk job', error);
      },
      async deleteJob(jobId) {
        const { error } = await supabase.from('bulk_jobs').delete().eq('id', jobId);
        if (error) fail('delete the bulk job', error);
      },
      async getSearchResults(searchIds) {
        const map = new Map<string, { companyName: string | null; results: RankedProfile[] }>();
        for (let i = 0; i < searchIds.length; i += 100) {
          const chunk = searchIds.slice(i, i + 100);
          const { data, error } = await supabase.from('searches').select('id, company_name, search_results(*)').in('id', chunk);
          if (error) fail('load the results', error);
          for (const row of data ?? []) {
            const results = [...((row.search_results ?? []) as SearchResultRow[])].sort((a, b) => a.rank - b.rank).map(mapResult);
            map.set(row.id, { companyName: row.company_name, results });
          }
        }
        return map;
      },
    },
  };
}
