// Calls to the Netlify Functions. The Supabase access token goes in the Authorization header;
// secret keys never reach the browser.

import type { ApiErrorBody, SearchResponse } from '@shared/types';
import { FUNCTIONS_BASE } from './config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: ApiErrorBody['code'] | 'network' | 'timeout',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const SEARCH_TIMEOUT_MS = 28_000;

async function postJson<T>(path: string, token: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  let response: Response;
  try {
    response = await fetch(`${FUNCTIONS_BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    if (signal?.aborted) throw new ApiError(0, 'The request was cancelled.', 'network');
    if (controller.signal.aborted) throw new ApiError(0, 'The search took too long. Please try again.', 'timeout');
    throw new ApiError(0, 'Could not reach the server. Check your internet connection and try again.', 'network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // A non-JSON response usually means the function is not deployed or was routed to the SPA.
  }

  if (!response.ok) {
    const body = data as Partial<ApiErrorBody> | null;
    const fallback =
      response.status === 404
        ? 'The search service was not found. Make sure the Netlify Functions are deployed (see README → Troubleshooting).'
        : response.status === 504
          ? 'The search took too long. Please try again.'
          : 'Something went wrong on the server. Please try again in a minute.';
    throw new ApiError(response.status, typeof body?.error === 'string' ? body.error : fallback, body?.code ?? 'server_error');
  }
  if (data === null) {
    throw new ApiError(response.status, 'The server returned an unexpected response (see README → Troubleshooting).', 'server_error');
  }
  return data as T;
}

export function searchRequest(token: string, body: { companyUrl: string; position: string; bulkJobId?: string }, signal?: AbortSignal) {
  return postJson<SearchResponse>('search', token, body, signal);
}

export function deleteAccountRequest(token: string) {
  return postJson<{ ok: true }>('delete-account', token, {});
}
