// Input validation and sanitization for the search request.

import { z } from 'zod';
import { parseCompanyUrl } from './domain';
import { normalizePosition } from './positionSynonyms';

/** Removes control characters and collapses whitespace. */
export function sanitizeText(value: string): string {
  return (
    value
      .normalize('NFC')
      // eslint-disable-next-line no-control-regex -- stripping control characters is the point
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, ' ')
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

const RequestSchema = z.object({
  companyUrl: z.string({ error: 'Please enter the company website.' }).max(500, 'The company website is too long.'),
  position: z.string({ error: 'Please enter a position, e.g. CTO.' }).max(300, 'The position must be 100 characters or fewer.'),
  bulkJobId: z.uuid({ error: 'Invalid bulk job.' }).nullish(),
});

export interface ValidSearchRequest {
  companyUrl: string;
  domain: string;
  position: string;
  positionNormalized: string;
  bulkJobId: string | null;
}

export type ValidationResult = { ok: true; value: ValidSearchRequest } | { ok: false; error: string };

export function validateSearchRequest(body: unknown): ValidationResult {
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request.' };
  }

  const companyUrl = sanitizeText(parsed.data.companyUrl);
  const company = parseCompanyUrl(companyUrl);
  if (!company.ok) return { ok: false, error: company.error };

  const position = sanitizeText(parsed.data.position);
  if (position.length < 2) return { ok: false, error: 'The position must be at least 2 characters, e.g. CTO.' };
  if (position.length > 100) return { ok: false, error: 'The position must be 100 characters or fewer.' };
  const positionNormalized = normalizePosition(position);
  if (!/\p{L}/u.test(positionNormalized)) return { ok: false, error: 'The position should contain letters, e.g. Head of Marketing.' };

  return {
    ok: true,
    value: { companyUrl, domain: company.domain, position, positionNormalized, bulkJobId: parsed.data.bulkJobId ?? null },
  };
}
