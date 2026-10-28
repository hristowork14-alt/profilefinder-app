// One plain-language status per bulk row, shared by the Bulk screen, the Excel file and the CSV,
// so the same row reads the same everywhere.

import { isSingleHolderRole } from '@shared/roleKind';
import type { ExportRow } from './csv';

export type StatusKey =
  | 'verified'
  | 'verified_elsewhere'
  | 'verified_name_match'
  | 'verified_no_profile'
  | 'likely'
  | 'match'
  | 'possible'
  | 'many'
  | 'closest'
  | 'conflict'
  | 'not_found'
  | 'failed'
  | 'pending';

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
  verified_elsewhere: {
    label: 'Verified — also works elsewhere',
    meaning:
      'Independent sources name this person in the role, and their LinkedIn profile lists this company and another current employer.',
    action: 'Ready to use; they hold more than one role.',
    group: 'found',
  },
  verified_name_match: {
    label: 'Verified — profile matched by name only',
    meaning:
      'Independent sources name this person in the role. The LinkedIn profile shown is the only one with that exact name, but it does not mention the company.',
    action: 'The name is right; check that the profile is theirs before using it.',
    group: 'review',
  },
  likely: {
    label: 'Likely — 1 source',
    meaning:
      'One independent source (for example the company website or an encyclopedia) names this person in the role; no second source confirms it.',
    action: 'Probably right — check before using.',
    group: 'review',
  },
  closest: {
    label: 'Closest matches',
    meaning: 'Nobody with this exact title was found. These people work at the company in a related role.',
    action: 'Use as a lead, or try a related title.',
    group: 'review',
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
  'verified_elsewhere',
  'verified_no_profile',
  'verified_name_match',
  'likely',
  'match',
  'possible',
  'many',
  'closest',
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
  if (row.decision === 'closest') return 'closest';
  if (row.decision === 'likely') return 'likely';
  if (row.decision === 'verified_name_match') return 'verified_name_match';
  if (row.decision === 'verified_elsewhere') return 'verified_elsewhere';
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
