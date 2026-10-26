// In-memory implementation of the storage the app needs. Used by the tests and, with a
// localStorage snapshot hook, by the browser demo (src/lib/backend/demoBackend.ts).

import type { PipelineTrace } from './pipeline';
import type { BulkJobRecord, BulkRowRecord, CacheRecord, SaveSearchInput, SearchStore, SearchWithResults } from './records';

export interface MemoryDb {
  searches: SearchWithResults[];
  bulkJobs: BulkJobRecord[];
  bulkRows: BulkRowRecord[];
  cache: CacheRecord[];
}

export interface MemoryStore extends SearchStore {
  readonly db: MemoryDb;
  /** Diagnostics by search id. Kept in memory only (never in the demo's localStorage snapshot). */
  readonly diagnostics: Map<string, PipelineTrace>;
  /** Convenience accessor for tests. */
  readonly searches: SearchWithResults[];
  createBulkJob(userId: string, fileName?: string, totalRows?: number): string;
  /** Call after any direct change to `db` so the snapshot hook runs. */
  commit(): void;
}

export function emptyDb(): MemoryDb {
  return { searches: [], bulkJobs: [], bulkRows: [], cache: [] };
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for very old browsers; uniqueness is all that matters here.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

export function createMemoryStore(
  initial: MemoryDb = emptyDb(),
  onChange?: (db: MemoryDb) => void,
  now: () => Date = () => new Date(),
): MemoryStore {
  const db = initial;
  const commit = () => onChange?.(db);
  const diagnostics = new Map<string, PipelineTrace>();

  return {
    db,
    diagnostics,
    get searches() {
      return db.searches;
    },
    commit,

    createBulkJob(userId, fileName = 'test.csv', totalRows = 1) {
      const id = newId();
      const stamp = now().toISOString();
      db.bulkJobs.push({ id, userId, fileName, totalRows, processedRows: 0, status: 'pending', createdAt: stamp, updatedAt: stamp });
      commit();
      return id;
    },

    async getCached(domain, positionNormalized, maxAgeMs) {
      const entry = db.cache.find((c) => c.domain === domain && c.positionNormalized === positionNormalized);
      if (!entry) return null;
      return now().getTime() - new Date(entry.createdAt).getTime() <= maxAgeMs ? entry : null;
    },

    async putCached(entry) {
      db.cache = db.cache.filter((c) => !(c.domain === entry.domain && c.positionNormalized === entry.positionNormalized));
      db.cache.push({ ...entry, createdAt: now().toISOString() });
      commit();
    },

    async countFreshSearchesSince(userId, since) {
      return db.searches.filter((s) => s.userId === userId && !s.fromCache && new Date(s.createdAt) >= since).length;
    },

    async userOwnsBulkJob(userId, bulkJobId) {
      return db.bulkJobs.some((job) => job.id === bulkJobId && job.userId === userId);
    },

    async saveSearch(input: SaveSearchInput) {
      const id = newId();
      db.searches.push({
        id,
        userId: input.userId,
        bulkJobId: input.bulkJobId,
        companyUrl: input.companyUrl,
        domain: input.domain,
        companyName: input.companyName,
        position: input.position,
        status: input.status,
        error: input.error,
        fromCache: input.fromCache,
        createdAt: now().toISOString(),
        resultCount: input.results.length,
        results: input.results.map((r) => ({ ...r })),
        ...(input.verifiedHolder !== undefined ? { verifiedHolder: input.verifiedHolder } : {}),
      });
      if (input.diagnostics) diagnostics.set(id, input.diagnostics);
      commit();
      return id;
    },
  };
}
