// Rate limits: counts the user's fresh (non-cached) searches in the `searches` table. Searches
// that failed on our side (search service down, timeout) don't count against the user.

import { dbTimeout, type AdminClient } from './supabaseAdmin';

export async function countFreshSearchesSince(admin: AdminClient, userId: string, since: Date): Promise<number> {
  const { count, error } = await admin
    .from('searches')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('from_cache', false)
    .neq('status', 'failed')
    .gte('created_at', since.toISOString())
    .abortSignal(dbTimeout());
  if (error) throw new Error(`rate limit count: ${error.message}`);
  return count ?? 0;
}
