// Supabase-backed implementation of the SearchStore interface.

import type { SearchStore } from '../../../shared/records';
import { getCached, putCached } from './cache';
import { saveSearch, userOwnsBulkJob } from './persist';
import { countFreshSearchesSince } from './rateLimit';
import type { AdminClient } from './supabaseAdmin';

export function createSupabaseStore(admin: AdminClient): SearchStore {
  return {
    getCached: (domain, positionNormalized, maxAgeMs) => getCached(admin, domain, positionNormalized, maxAgeMs),
    putCached: (entry) => putCached(admin, entry),
    countFreshSearchesSince: (userId, since) => countFreshSearchesSince(admin, userId, since),
    userOwnsBulkJob: (userId, bulkJobId) => userOwnsBulkJob(admin, userId, bulkJobId),
    saveSearch: (input) => saveSearch(admin, input),
  };
}
