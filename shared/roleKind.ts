// Is a position normally held by one person at a company (CEO, Head of Design) or by many at once
// (Engineer, Recruiter)? Only single-holder roles can be "verified" through independent sources:
// for a role many people hold, a page naming one of them proves nothing about the others, and in
// production it led to job ads and old press releases being read as "the" holder.

import { normalizePosition } from './positionSynonyms';

const SINGLE_HOLDER_WORDS =
  /\b(?:chief|head|president|founder|cofounder|co founder|owner|chair|chairman|chairwoman|chairperson|director|vp|svp|evp|treasurer|general manager|managing director|country manager)\b/;
/** C-level abbreviations: CEO, CTO, CFO, COO, CMO, CIO, CPO, CRO, CISO, CHRO, CDO … */
const C_LEVEL = /^c[a-z]{1,3}o$/;

/**
 * The top role of the function a "Head of X" / "X Director" / "VP X" position leads, for when
 * nobody is named for the exact title: "Head of Design" → "Chief Design Officer". The C-level
 * titles already in the synonym list come first ("Head of Engineering" → "Chief Technology Officer").
 */
export function topRoleTitles(position: string, synonyms: string[]): string[] {
  const trimmed = position.trim().replace(/\s+/g, ' ');
  const field =
    /^head of (.+)$/i.exec(trimmed)?.[1] ??
    /^(?:vp|svp|evp|vice president)(?: of)? (.+)$/i.exec(trimmed)?.[1] ??
    /^(.+?) director$/i.exec(trimmed)?.[1] ??
    null;
  if (!field || /\b(?:chief|officer)\b/i.test(field)) return [];
  const fromSynonyms = synonyms.filter((s) => /^chief .+ officer$/i.test(s.trim()));
  const titleCase = field
    .split(' ')
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
  const generated = `Chief ${titleCase} Officer`;
  const seen = new Set<string>();
  return [...fromSynonyms, generated]
    .filter((t) => {
      const key = normalizePosition(t);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 2);
}

export function isSingleHolderRole(position: string): boolean {
  const normalized = normalizePosition(position);
  if (!normalized) return false;
  if (SINGLE_HOLDER_WORDS.test(normalized)) return true;
  return normalized.split(' ').some((word) => C_LEVEL.test(word));
}
