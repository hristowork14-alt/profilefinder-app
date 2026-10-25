// Hourly rate limit: counts the user's fresh (non-cached) searches in the `searches` table.

import { dbTimeout, type AdminClient } from './supabaseAdmin';

export async function countFreshSearchesSince(admin: AdminClient, userId: string, since: Date): Promise<number> {
  const { count, error } = await admin
    .from('searches')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('from_cache', false)
    .gte('created_at', since.toISOString())
    .abortSignal(dbTimeout());
  if (error) throw new Error(`rate limit count: ${error.message}`);
  return count ?? 0;
}
