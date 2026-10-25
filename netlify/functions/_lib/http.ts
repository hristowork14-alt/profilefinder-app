// Small HTTP helpers for the Netlify Functions.

import type { ApiErrorBody } from '../../../shared/types';

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...headers } });
}

export function errorResponse(status: number, code: ApiErrorBody['code'], error: string, headers: Record<string, string> = {}): Response {
  const body: ApiErrorBody = { error, code };
  return json(status, body, headers);
}

export class BodyError extends Error {}

/** Reads a JSON body, refusing anything larger than `maxBytes`. */
export async function readJsonBody(req: Request, maxBytes = 10_000): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new BodyError('The request is too large.');
  const text = await req.text();
  if (text.length > maxBytes) throw new BodyError('The request is too large.');
  if (!text.trim()) throw new BodyError('The request body is empty.');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BodyError('The request body is not valid JSON.');
  }
}

/** Extracts the bearer token from the Authorization header. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/);
  return match?.[1] ?? null;
}
