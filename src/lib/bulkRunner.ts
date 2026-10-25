// Processes a bulk job from the browser: 2 rows at a time through the same `search` call.
// Every row's outcome is written to the database as it happens, so a job interrupted by
// closing the tab can be resumed later — unfinished rows are simply still "pending".

import type { BulkRowRecord } from '@shared/records';
import { ApiError } from './api';
import type { Backend } from './backend/types';
import type { ExportRow } from './csv';

export const BULK_CONCURRENCY = 2;

export type RunOutcome = 'completed' | 'paused_rate_limit' | 'stopped';

export interface RunCallbacks {
  onProgress?: (processed: number, total: number) => void;
  onRowDone?: (row: BulkRowRecord) => void;
  /** Return true to stop taking new rows (e.g. the user left the page). */
  shouldStop?: () => boolean;
}

export async function runBulkJob(
  backend: Backend,
  jobId: string,
  callbacks: RunCallbacks = {},
): Promise<{ outcome: RunOutcome; message: string | null }> {
  const rows = await backend.bulk.listRows(jobId);
  const total = rows.length;
  // "running" rows were in flight when the page closed; they are retried.
  const queue = rows.filter((r) => r.status === 'pending' || r.status === 'running');
  let processed = rows.length - queue.length;
  callbacks.onProgress?.(processed, total);

  if (queue.length === 0) {
    await backend.bulk.setJobStatus(jobId, rows.every((r) => r.status === 'failed') ? 'failed' : 'completed');
    return { outcome: 'completed', message: null };
  }

  await backend.bulk.setJobStatus(jobId, 'running');
  let rateLimited: string | null = null;
  let stopped = false;

  const worker = async () => {
    while (queue.length > 0) {
      if (rateLimited) return;
      if (callbacks.shouldStop?.()) {
        stopped = true;
        return;
      }
      const row = queue.shift();
      if (!row) return;

      await backend.bulk.updateRow(row.id, { status: 'running' });
      let patch: Pick<BulkRowRecord, 'status' | 'searchId' | 'error'>;
      try {
        const response = await backend.search({ companyUrl: row.companyUrl, position: row.position, bulkJobId: jobId });
        patch = response.searchId
          ? { status: 'completed', searchId: response.searchId, error: null }
          : { status: 'failed', searchId: null, error: response.message ?? 'Results could not be saved.' };
      } catch (error) {
        if (error instanceof ApiError && error.status === 429) {
          // Over the hourly limit: put the row back and pause the whole job.
          rateLimited = error.message;
          await backend.bulk.updateRow(row.id, { status: 'pending' });
          return;
        }
        if (error instanceof ApiError && error.status === 401) throw error;
        patch = { status: 'failed', searchId: null, error: error instanceof Error ? error.message : 'Search failed.' };
      }

      await backend.bulk.updateRow(row.id, patch);
      processed = await backend.bulk.refreshProgress(jobId);
      callbacks.onRowDone?.({ ...row, ...patch });
      callbacks.onProgress?.(processed, total);
    }
  };

  await Promise.all(Array.from({ length: BULK_CONCURRENCY }, worker));

  if (rateLimited) return { outcome: 'paused_rate_limit', message: rateLimited };
  if (stopped) return { outcome: 'stopped', message: null };

  const finalRows = await backend.bulk.listRows(jobId);
  const remaining = finalRows.some((r) => r.status === 'pending' || r.status === 'running');
  if (remaining) return { outcome: 'stopped', message: null };
  await backend.bulk.setJobStatus(jobId, finalRows.every((r) => r.status === 'failed') ? 'failed' : 'completed');
  return { outcome: 'completed', message: null };
}

/** Rows for the results CSV, in the original file order. */
export async function collectExportRows(backend: Backend, jobId: string): Promise<ExportRow[]> {
  const rows = await backend.bulk.listRows(jobId);
  const ids = rows.map((r) => r.searchId).filter((id): id is string => Boolean(id));
  const results = await backend.bulk.getSearchResults(ids);
  return rows.map((row) => {
    const found = row.searchId ? results.get(row.searchId) : undefined;
    return { companyUrl: row.companyUrl, position: row.position, companyName: found?.companyName ?? null, results: found?.results ?? [] };
  });
}
