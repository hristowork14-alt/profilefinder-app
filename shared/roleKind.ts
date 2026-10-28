// Is a position normally held by one person at a company (CEO, Head of Design) or by many at once
// (Engineer, Recruiter)? Only single-holder roles can be "verified" through independent sources:
// for a role many people hold, a page naming one of them proves nothing about the others, and in
// production it led to job ads and old press releases being read as "the" holder.

import { normalizePosition } from './positionSynonyms';

const SINGLE_HOLDER_WORDS =
  /\b(?:chief|head|president|founder|cofounder|co founder|owner|chair|chairman|chairwoman|chairperson|director|vp|svp|evp|treasurer|general manager|managing director|country manager)\b/;
/** C-level abbreviations: CEO, CTO, CFO, COO, CMO, CIO, CPO, CRO, CISO, CHRO, CDO … */
const C_LEVEL = /^c[a-z]{1,3}o$/;

export function isSingleHolderRole(position: string): boolean {
  const normalized = normalizePosition(position);
  if (!normalized) return false;
  if (SINGLE_HOLDER_WORDS.test(normalized)) return true;
  return normalized.split(' ').some((word) => C_LEVEL.test(word));
}
