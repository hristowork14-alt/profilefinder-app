// Processes a bulk job from the browser: 2 rows at a time through the same `search` call.
// Every row's outcome is written to the database as it happens, so a job interrupted by
// closing the tab can be resumed later — unfinished rows are simply still "pending".
//
// For a full 100-row file:
//   • a temporary error (network, timeout, 5xx) is retried once after a short pause before the row
//     is marked failed; invalid input and other permanent errors are not retried;
//   • a row that repeats an earlier row (same company website and position) reuses that row's
//     search instead of searching (and paying) again;
//   • failed rows with valid input can be put back in the queue later ("Retry failed rows").

import { parseCompanyUrl } from '@shared/domain';
import { normalizePosition } from '@shared/positionSynonyms';
import type { BulkRowRecord } from '@shared/records';
import { ApiError } from './api';
import type { Backend, SearchExport } from './backend/types';
import { validateRowInput, type ExportRow } from './csv';

export const BULK_CONCURRENCY = 2;
/** Typical time one row takes (from production searches), used before there is a measurement. */
export const TYPICAL_ROW_SECONDS = 9;
const DEFAULT_RETRY_DELAY_MS = 3000;

export type RunOutcome = 'completed' | 'paused_rate_limit' | 'stopped';

export interface RunCallbacks {
  onProgress?: (processed: number, total: number) => void;
  onRowDone?: (row: BulkRowRecord) => void;
  /** Return true to stop taking new rows (e.g. the user left the page). */
  shouldStop?: () => boolean;
  /** How many times a row is retried after a temporary error (default 1; the demo passes 0). */
  retries?: number;
  /** Pause before a retry (default 3 s). */
  retryDelayMs?: number;
}

/** Errors worth one more try: no answer, timeout, a server-side failure, or anything unexpected. */
function isTemporary(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
}

/** Two rows ask the same question when the website and the position are the same. */
export function rowKey(companyUrl: string, position: string): string {
  const parsed = parseCompanyUrl(companyUrl);
  return `${parsed.ok ? parsed.domain : companyUrl.trim().toLowerCase()}|${normalizePosition(position)}`;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  const retries = callbacks.retries ?? 1;
  const retryDelayMs = callbacks.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  // Searches already answered in this job, by question — finished rows and rows in flight.
  const answered = new Map<string, Promise<string | null>>();
  for (const row of rows) {
    if (row.status === 'completed' && row.searchId) answered.set(rowKey(row.companyUrl, row.position), Promise.resolve(row.searchId));
  }

  const searchOnce = async (row: BulkRowRecord): Promise<Pick<BulkRowRecord, 'status' | 'searchId' | 'error'>> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await backend.search({ companyUrl: row.companyUrl, position: row.position, bulkJobId: jobId });
        return response.searchId
          ? { status: 'completed', searchId: response.searchId, error: null }
          : { status: 'failed', searchId: null, error: response.message ?? 'Results could not be saved.' };
      } catch (error) {
        if (error instanceof ApiError && (error.status === 429 || error.status === 401)) throw error;
        if (attempt < retries && isTemporary(error)) {
          await sleep(retryDelayMs);
          continue;
        }
        return { status: 'failed', searchId: null, error: error instanceof Error ? error.message : 'Search failed.' };
      }
    }
  };

  const worker = async () => {
    while (queue.length > 0) {
      if (rateLimited) return;
      if (callbacks.shouldStop?.()) {
        stopped = true;
        return;
      }
      const row = queue.shift();
      if (!row) return;

      // Claim this question before the first await, so a duplicate row in the other worker waits for it.
      const key = rowKey(row.companyUrl, row.position);
      const earlier = answered.get(key);
      let settle: (searchId: string | null) => void = () => {};
      if (!earlier) answered.set(key, new Promise<string | null>((resolve) => (settle = resolve)));

      let patch: Pick<BulkRowRecord, 'status' | 'searchId' | 'error'>;
      try {
        await backend.bulk.updateRow(row.id, { status: 'running' });
        const reused = earlier ? await earlier : null;
        if (reused) {
          patch = { status: 'completed', searchId: reused, error: null };
        } else {
          patch = await searchOnce(row);
          if (!earlier) {
            settle(patch.searchId);
            if (!patch.searchId) answered.delete(key);
          }
        }
      } catch (error) {
        if (!earlier) {
          settle(null);
          answered.delete(key);
        }
        if (error instanceof ApiError && error.status === 429) {
          // Over the hourly limit: put the row back and pause the whole job.
          rateLimited = error.message;
          await backend.bulk.updateRow(row.id, { status: 'pending' });
          return;
        }
        throw error;
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

/**
 * Puts failed rows whose input is valid back in the queue (they failed for a temporary reason).
 * Rows with invalid input stay failed. Returns how many rows were reset.
 */
export async function resetFailedRows(backend: Backend, jobId: string): Promise<number> {
  const rows = await backend.bulk.listRows(jobId);
  const retryable = rows.filter((r) => r.status === 'failed' && validateRowInput(r.companyUrl, r.position) === null);
  for (const row of retryable) await backend.bulk.updateRow(row.id, { status: 'pending', searchId: null, error: null });
  if (retryable.length > 0) await backend.bulk.refreshProgress(jobId);
  return retryable.length;
}

/** Rows for the results export (Excel / CSV) and the results table, in the original file order. */
export async function collectExportRows(backend: Backend, jobId: string): Promise<ExportRow[]> {
  const rows = await backend.bulk.listRows(jobId);
  const ids = [...new Set(rows.map((r) => r.searchId).filter((id): id is string => Boolean(id)))];
  const results = await backend.bulk.getSearchResults(ids);
  return rows.map((row) => toExportRow(row, row.searchId ? results.get(row.searchId) : undefined));
}

/** One bulk row with its search result, as the export and the results table use it. */
export function toExportRow(row: BulkRowRecord, found: SearchExport | undefined): ExportRow {
  return {
    companyUrl: row.companyUrl,
    position: row.position,
    companyName: found?.companyName ?? null,
    results: found?.results ?? [],
    status: row.status,
    error: row.error,
    rowNumber: row.rowIndex + 1,
    ...(found && found.verifiedHolder !== undefined ? { verifiedHolder: found.verifiedHolder } : {}),
    ...(found?.decision ? { decision: found.decision } : {}),
  };
}
