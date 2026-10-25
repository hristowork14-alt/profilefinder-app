// Demo backend (VITE_DEMO_MODE=true): everything runs in this browser tab.
// - Accounts and data are kept in localStorage (or memory if storage is blocked).
// - Searches go through the SAME searchService + pipeline as the Netlify function,
//   with the fixture search provider, fixture homepage fetcher and fixture "Claude".
// Nothing is sent to any server.

import { createMemoryStore, emptyDb, newId, type MemoryDb } from '@shared/memoryStore';
import { createMockHomepageFetcher, createMockLlmClient, createMockSearchProvider } from '@shared/mocks';
import type { JobStatus } from '@shared/records';
import type { RankedProfile } from '@shared/types';
import { performSearch } from '@shared/searchService';
import { ApiError } from '../api';
import type { AuthEvent, AuthUser, Backend } from './types';

const STORAGE_KEY = 'profilefinder-demo-v1';
const DEMO_LIMIT_PER_HOUR = 30;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface DemoAccount {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

interface DemoState {
  accounts: DemoAccount[];
  sessionUserId: string | null;
  db: MemoryDb;
}

function loadState(): DemoState {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DemoState>;
      return {
        accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
        sessionUserId: typeof parsed.sessionUserId === 'string' ? parsed.sessionUserId : null,
        db: { ...emptyDb(), ...(parsed.db ?? {}) },
      };
    }
  } catch {
    // Storage blocked or corrupt — start fresh in memory.
  }
  return { accounts: [], sessionUserId: null, db: emptyDb() };
}

async function hashPassword(email: string, password: string): Promise<string> {
  const input = `profilefinder-demo|${email.toLowerCase()}|${password}`;
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // crypto.subtle needs a secure context; this fallback is only for odd local setups.
    let hash = 0;
    for (let i = 0; i < input.length; i++) hash = (Math.imul(31, hash) + input.charCodeAt(i)) | 0;
    return `weak-${hash >>> 0}`;
  }
}

export interface DemoOptions {
  /** 1 = realistic delays, 0 = instant (tests). */
  latencyScale?: number;
  maxSearchesPerHour?: number;
}

export function createDemoBackend(options: DemoOptions = {}): Backend {
  const scale = options.latencyScale ?? 1;
  const maxSearchesPerHour = options.maxSearchesPerHour ?? DEMO_LIMIT_PER_HOUR;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms * scale));
  const state = loadState();
  const listeners = new Set<(user: AuthUser | null, event: AuthEvent) => void>();

  const save = () => {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore — the demo keeps working in memory.
    }
  };
  const store = createMemoryStore(state.db, save);

  const currentUser = (): AuthUser | null => {
    const account = state.accounts.find((a) => a.id === state.sessionUserId);
    return account ? { id: account.id, email: account.email } : null;
  };
  const emit = (event: AuthEvent) => listeners.forEach((listener) => listener(currentUser(), event));
  const requireUser = (): AuthUser => {
    const user = currentUser();
    if (!user) throw new ApiError(401, 'Your session has expired. Please log in again.', 'unauthorized');
    return user;
  };
  const ownsJob = (jobId: string) => state.db.bulkJobs.find((j) => j.id === jobId && j.userId === requireUser().id);

  return {
    mode: 'demo',

    auth: {
      async getUser() {
        return currentUser();
      },
      onChange(callback) {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
      async signUp(email, password) {
        await wait(300);
        const normalized = email.trim().toLowerCase();
        if (state.accounts.some((a) => a.email === normalized))
          throw new Error('An account with this email already exists. Log in instead.');
        const account: DemoAccount = {
          id: newId(),
          email: normalized,
          passwordHash: await hashPassword(normalized, password),
          createdAt: new Date().toISOString(),
        };
        state.accounts.push(account);
        state.sessionUserId = account.id;
        save();
        emit('SIGNED_IN');
        return { needsConfirmation: false };
      },
      async signIn(email, password) {
        await wait(300);
        const normalized = email.trim().toLowerCase();
        const account = state.accounts.find((a) => a.email === normalized);
        if (!account || account.passwordHash !== (await hashPassword(normalized, password))) throw new Error('Wrong email or password.');
        state.sessionUserId = account.id;
        save();
        emit('SIGNED_IN');
      },
      async signInWithGoogle() {
        throw new Error('Google sign-in works once Supabase is set up (see README). In the demo, sign up with any email.');
      },
      async signOut() {
        state.sessionUserId = null;
        save();
        emit('SIGNED_OUT');
      },
      async requestPasswordReset() {
        await wait(300);
        // In the real app Supabase emails a reset link. Nothing is sent in the demo.
      },
      async openDemoRecoveryLink(email) {
        const account = state.accounts.find((a) => a.email === email.trim().toLowerCase());
        if (!account) throw new Error('No demo account uses that email. Sign up first.');
        state.sessionUserId = account.id;
        save();
        emit('PASSWORD_RECOVERY');
      },
      async updatePassword(newPassword) {
        const user = requireUser();
        const account = state.accounts.find((a) => a.id === user.id);
        if (!account) throw new Error('Account not found.');
        account.passwordHash = await hashPassword(account.email, newPassword);
        save();
        emit('USER_UPDATED');
      },
      async deleteAccount() {
        const user = requireUser();
        await wait(300);
        // Mirrors ON DELETE CASCADE: every record of this user goes.
        const jobIds = new Set(state.db.bulkJobs.filter((j) => j.userId === user.id).map((j) => j.id));
        state.db.searches = state.db.searches.filter((s) => s.userId !== user.id);
        state.db.bulkJobs = state.db.bulkJobs.filter((j) => j.userId !== user.id);
        state.db.bulkRows = state.db.bulkRows.filter((r) => !jobIds.has(r.bulkJobId));
        state.accounts = state.accounts.filter((a) => a.id !== user.id);
        state.sessionUserId = null;
        save();
        emit('SIGNED_OUT');
      },
    },

    async search(input, options) {
      const user = requireUser();
      const outcome = await performSearch(user.id, input, {
        store,
        pipelineDeps: {
          searchProvider: createMockSearchProvider({ latencyScale: scale }),
          fetchHomepage: createMockHomepageFetcher({ latencyScale: scale }),
          llm: createMockLlmClient({ latencyScale: scale }),
          onProgress: options?.onStep,
        },
        config: { maxSearchesPerHour, cacheTtlMs: CACHE_TTL_MS },
      });
      if (outcome.status !== 200) throw new ApiError(outcome.status, outcome.body.error, outcome.body.code);
      // A cache hit is instant; pause briefly so the UI can show it happened.
      if (outcome.body.fromCache) await wait(250);
      return outcome.body;
    },

    history: {
      async list() {
        const user = requireUser();
        return state.db.searches
          .filter((s) => s.userId === user.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 200)
          .map(({ results: _results, ...record }) => record);
      },
      async get(searchId) {
        const user = requireUser();
        const search = state.db.searches.find((s) => s.id === searchId && s.userId === user.id);
        return search ? { ...search, results: [...search.results] } : null;
      },
      async remove(searchId) {
        const user = requireUser();
        state.db.searches = state.db.searches.filter((s) => !(s.id === searchId && s.userId === user.id));
        state.db.bulkRows.forEach((row) => {
          if (row.searchId === searchId) row.searchId = null; // ON DELETE SET NULL
        });
        save();
      },
      async removeAll() {
        const user = requireUser();
        const jobIds = new Set(state.db.bulkJobs.filter((j) => j.userId === user.id).map((j) => j.id));
        state.db.searches = state.db.searches.filter((s) => s.userId !== user.id);
        state.db.bulkJobs = state.db.bulkJobs.filter((j) => j.userId !== user.id);
        state.db.bulkRows = state.db.bulkRows.filter((r) => !jobIds.has(r.bulkJobId));
        save();
      },
    },

    bulk: {
      async createJob(fileName, rows) {
        const user = requireUser();
        const stamp = new Date().toISOString();
        const job = {
          id: newId(),
          userId: user.id,
          fileName: fileName.slice(0, 255) || 'upload.csv',
          totalRows: rows.length,
          processedRows: rows.filter((r) => r.error).length,
          status: 'pending' as JobStatus,
          createdAt: stamp,
          updatedAt: stamp,
        };
        state.db.bulkJobs.push(job);
        rows.forEach((row, index) =>
          state.db.bulkRows.push({
            id: newId(),
            bulkJobId: job.id,
            rowIndex: index,
            companyUrl: row.companyUrl,
            position: row.position,
            status: row.error ? 'failed' : 'pending',
            searchId: null,
            error: row.error,
          }),
        );
        save();
        return { ...job };
      },
      async listJobs() {
        const user = requireUser();
        return state.db.bulkJobs
          .filter((j) => j.userId === user.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 20)
          .map((j) => ({ ...j }));
      },
      async getJob(jobId) {
        const job = ownsJob(jobId);
        return job ? { ...job } : null;
      },
      async listRows(jobId) {
        if (!ownsJob(jobId)) return [];
        return state.db.bulkRows
          .filter((r) => r.bulkJobId === jobId)
          .sort((a, b) => a.rowIndex - b.rowIndex)
          .map((r) => ({ ...r }));
      },
      async updateRow(rowId, patch) {
        const row = state.db.bulkRows.find((r) => r.id === rowId);
        if (!row || !ownsJob(row.bulkJobId)) throw new Error('Row not found.');
        Object.assign(row, patch);
        save();
      },
      async refreshProgress(jobId) {
        const job = ownsJob(jobId);
        if (!job) return 0;
        job.processedRows = state.db.bulkRows.filter(
          (r) => r.bulkJobId === jobId && (r.status === 'completed' || r.status === 'failed'),
        ).length;
        job.updatedAt = new Date().toISOString();
        save();
        return job.processedRows;
      },
      async setJobStatus(jobId, status) {
        const job = ownsJob(jobId);
        if (!job) throw new Error('Bulk job not found.');
        job.status = status;
        job.updatedAt = new Date().toISOString();
        save();
      },
      async deleteJob(jobId) {
        if (!ownsJob(jobId)) return;
        state.db.bulkJobs = state.db.bulkJobs.filter((j) => j.id !== jobId);
        state.db.bulkRows = state.db.bulkRows.filter((r) => r.bulkJobId !== jobId);
        state.db.searches.forEach((s) => {
          if (s.bulkJobId === jobId) s.bulkJobId = null;
        });
        save();
      },
      async getSearchResults(searchIds) {
        const user = requireUser();
        const wanted = new Set(searchIds);
        const map = new Map<string, { companyName: string | null; results: RankedProfile[] }>();
        for (const search of state.db.searches) {
          if (wanted.has(search.id) && search.userId === user.id)
            map.set(search.id, { companyName: search.companyName, results: [...search.results] });
        }
        return map;
      },
    },
  };
}
