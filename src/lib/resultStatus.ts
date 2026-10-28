// One plain-language status per bulk row, shared by the Bulk screen, the Excel file and the CSV,
// so the same row reads the same everywhere.

import { isSingleHolderRole } from '@shared/roleKind';
import type { ExportRow } from './csv';

export type StatusKey =
  'verified' | 'verified_no_profile' | 'match' | 'possible' | 'many' | 'conflict' | 'not_found' | 'failed' | 'pending';

/** found = usable as is; review = check before using; none = nothing to use. */
export type StatusGroup = 'found' | 'review' | 'none';

export interface StatusInfo {
  key: StatusKey;
  label: string;
  /** One sentence for the legend. */
  meaning: string;
  /** What to do about it (legend). */
  action: string;
  group: StatusGroup;
}

const INFO: Record<StatusKey, Omit<StatusInfo, 'key'>> = {
  verified: {
    label: 'Verified',
    meaning: 'Independent sources (not LinkedIn) name this person in the role, and their LinkedIn profile matches.',
    action: 'Ready to use.',
    group: 'found',
  },
  verified_no_profile: {
    label: 'Verified — no LinkedIn found',
    meaning: 'Independent sources name this person in the role, but no public LinkedIn profile could be found for them.',
    action: 'Use the name; look them up another way if you need a profile.',
    group: 'found',
  },
  match: {
    label: 'Match found',
    meaning: 'A LinkedIn profile matches the company and role (demo: no independent verification).',
    action: 'Check before using.',
    group: 'found',
  },
  possible: {
    label: 'Possible match — not verified',
    meaning: 'A LinkedIn profile matches the company and role, but no independent source confirms this person holds it today.',
    action: 'Check the profile before using it.',
    group: 'review',
  },
  many: {
    label: 'Possible match — many hold this role',
    meaning: 'Many people hold this role at the company. This is one well-matching profile, not "the" holder.',
    action: 'Use as a lead; add seniority or a team to the position for a single person.',
    group: 'review',
  },
  conflict: {
    label: 'Conflicting information',
    meaning: 'Sources name someone, but their LinkedIn profile disagrees (for example it shows another employer).',
    action: 'Check before using — they may have moved on, or it may be a namesake.',
    group: 'review',
  },
  not_found: {
    label: 'Not found',
    meaning: 'No credible person or profile was found for this company and role.',
    action: 'Try a broader or more common title (e.g. "Head of Marketing" instead of a niche title).',
    group: 'none',
  },
  failed: {
    label: 'Failed',
    meaning: 'The search could not run: the input was invalid, or a temporary error happened.',
    action: 'Fix the input, or use "Retry failed rows".',
    group: 'none',
  },
  pending: {
    label: 'Not searched yet',
    meaning: 'This row has not been searched yet.',
    action: 'Resume the bulk job.',
    group: 'none',
  },
};

/** Display order (legend, summary counts). */
export const STATUS_ORDER: StatusKey[] = [
  'verified',
  'verified_no_profile',
  'match',
  'possible',
  'many',
  'conflict',
  'not_found',
  'failed',
  'pending',
];

export function statusInfo(key: StatusKey): StatusInfo {
  return { key, ...INFO[key] };
}

export function rowStatus(row: ExportRow): StatusKey {
  if (row.status === 'failed') return 'failed';
  if (row.status === 'pending' || row.status === 'running') return 'pending';
  const top = row.results[0];
  if (row.decision === 'contradicted') return 'conflict';
  if (top?.verified) return 'verified';
  if (!top) return row.verifiedHolder ? 'verified_no_profile' : 'not_found';
  // No verification at all (demo, or very old searches): just a match.
  if (row.verifiedHolder === undefined && !row.decision) return 'match';
  return isSingleHolderRole(row.position) ? 'possible' : 'many';
}

export function statusCounts(rows: ExportRow[]): { key: StatusKey; label: string; count: number }[] {
  const counts = new Map<StatusKey, number>();
  for (const row of rows) {
    const key = rowStatus(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return STATUS_ORDER.filter((key) => counts.has(key)).map((key) => ({ key, label: INFO[key].label, count: counts.get(key) ?? 0 }));
}
