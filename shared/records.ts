// App-level record shapes used by the UI and by the in-memory / demo store.
// The Supabase rows (src/types/database.ts) are mapped into these.

import type { RankedProfile } from './types';

export type SearchStatus = 'completed' | 'no_results' | 'failed';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface SearchRecord {
  id: string;
  userId: string;
  bulkJobId: string | null;
  companyUrl: string;
  domain: string | null;
  companyName: string | null;
  position: string;
  status: SearchStatus;
  error: string | null;
  fromCache: boolean;
  createdAt: string;
  resultCount: number;
}

export interface SearchWithResults extends SearchRecord {
  results: RankedProfile[];
}

export interface BulkJobRecord {
  id: string;
  userId: string;
  fileName: string;
  totalRows: number;
  processedRows: number;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BulkRowRecord {
  id: string;
  bulkJobId: string;
  rowIndex: number;
  companyUrl: string;
  position: string;
  status: JobStatus;
  searchId: string | null;
  error: string | null;
}

export interface CacheRecord {
  domain: string;
  positionNormalized: string;
  companyName: string;
  results: RankedProfile[];
  createdAt: string;
}

export interface SaveSearchInput {
  userId: string;
  bulkJobId: string | null;
  companyUrl: string;
  domain: string | null;
  companyName: string | null;
  position: string;
  status: SearchStatus;
  error: string | null;
  fromCache: boolean;
  results: RankedProfile[];
}

/** Everything the search service needs from storage. Supabase in production, memory in the demo/tests. */
export interface SearchStore {
  getCached(domain: string, positionNormalized: string, maxAgeMs: number): Promise<CacheRecord | null>;
  putCached(entry: Omit<CacheRecord, 'createdAt'>): Promise<void>;
  countFreshSearchesSince(userId: string, since: Date): Promise<number>;
  userOwnsBulkJob(userId: string, bulkJobId: string): Promise<boolean>;
  saveSearch(input: SaveSearchInput): Promise<string>;
}
