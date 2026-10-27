// The one interface the UI talks to. Two implementations:
//   supabaseBackend — the real app (Supabase Auth + DB, Netlify Functions)
//   demoBackend     — runs entirely in the browser with fixture data (VITE_DEMO_MODE=true)

import type { BulkJobRecord, BulkRowRecord, JobStatus, SearchRecord, SearchWithResults } from '@shared/records';
import type { PipelineStep, RankedProfile, SearchResponse, VerifiedHolder } from '@shared/types';

export interface AuthUser {
  id: string;
  email: string;
}

export type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'PASSWORD_RECOVERY' | 'USER_UPDATED' | 'INITIAL';

export interface AuthApi {
  getUser(): Promise<AuthUser | null>;
  onChange(callback: (user: AuthUser | null, event: AuthEvent) => void): () => void;
  /**
   * Returns true when the user must confirm their email before logging in.
   * captchaToken (sign-up, log-in, reset request): the Turnstile token, when the human check is on.
   */
  signUp(email: string, password: string, captchaToken?: string): Promise<{ needsConfirmation: boolean }>;
  signIn(email: string, password: string, captchaToken?: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string, captchaToken?: string): Promise<void>;
  updatePassword(newPassword: string): Promise<void>;
  deleteAccount(): Promise<void>;
  /** Demo only: stands in for clicking the link in the reset email. */
  openDemoRecoveryLink?(email: string): Promise<void>;
}

export interface SearchInput {
  companyUrl: string;
  position: string;
  bulkJobId?: string;
}

export interface NewBulkRow {
  companyUrl: string;
  position: string;
  /** Rows that failed validation are stored as failed right away. */
  error: string | null;
}

export interface SearchExport {
  companyName: string | null;
  results: RankedProfile[];
  /** Real app: the verified holder, or null when verification found nobody. Demo: absent. */
  verifiedHolder?: VerifiedHolder | null;
}

export interface BulkApi {
  createJob(fileName: string, rows: NewBulkRow[]): Promise<BulkJobRecord>;
  listJobs(): Promise<BulkJobRecord[]>;
  getJob(jobId: string): Promise<BulkJobRecord | null>;
  listRows(jobId: string): Promise<BulkRowRecord[]>;
  updateRow(rowId: string, patch: Partial<Pick<BulkRowRecord, 'status' | 'searchId' | 'error'>>): Promise<void>;
  /** Recounts finished rows in the database and returns the new processed count. */
  refreshProgress(jobId: string): Promise<number>;
  setJobStatus(jobId: string, status: JobStatus): Promise<void>;
  deleteJob(jobId: string): Promise<void>;
  /** Company name + results (and, in the real app, the verified holder) for the given searches (for the export). */
  getSearchResults(searchIds: string[]): Promise<Map<string, SearchExport>>;
}

export interface HistoryApi {
  list(): Promise<SearchRecord[]>;
  get(searchId: string): Promise<SearchWithResults | null>;
  remove(searchId: string): Promise<void>;
  /** Deletes every search and bulk job of the current user. */
  removeAll(): Promise<void>;
}

export interface Backend {
  mode: 'demo' | 'supabase';
  auth: AuthApi;
  search(input: SearchInput, options?: { onStep?: (step: PipelineStep) => void; signal?: AbortSignal }): Promise<SearchResponse>;
  history: HistoryApi;
  bulk: BulkApi;
}
