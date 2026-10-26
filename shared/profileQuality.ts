// Strategy S4: cheap signals about a LinkedIn profile, read only from the search result text
// (never by visiting LinkedIn). Self-declared "CEO of <big company>" profiles typically show
// "0 followers", no location and no experience. These signals only downgrade or break ties;
// they never prove that someone holds a role.

import type { Candidate } from './types';

export interface ProfileSignals {
  /** Largest follower/connection count found in the text, or null if none is shown. */
  audience: number | null;
  hasLocation: boolean;
  hasExperience: boolean;
  /** LinkedIn's auto-generated slug suffix (e.g. "-a13481385"), typical of newer accounts. */
  randomSlug: boolean;
  /** Looks like a thin, possibly self-declared profile. */
  thin: boolean;
  /** Short human-readable summary for the ranking prompt. */
  summary: string;
}

const AUDIENCE = /(\d[\d,.]*)\s*([km])?\+?\s+(followers?|connections?)/gi;
/** Under this many followers/connections a profile counts as having no real audience. */
const MIN_AUDIENCE = 50;

function parseCount(digits: string, suffix: string | undefined): number {
  const value = Number.parseFloat(digits.replace(/,/g, ''));
  if (!Number.isFinite(value)) return 0;
  const multiplier = suffix?.toLowerCase() === 'm' ? 1_000_000 : suffix?.toLowerCase() === 'k' ? 1_000 : 1;
  return Math.round(value * multiplier);
}

export function profileSignals(candidate: Candidate): ProfileSignals {
  const text = `${candidate.title} ${candidate.snippet}`;
  let audience: number | null = null;
  for (const match of text.matchAll(AUDIENCE)) {
    const count = parseCount(match[1] ?? '', match[2]);
    audience = audience === null ? count : Math.max(audience, count);
  }
  const hasLocation = /\blocation\s*:/i.test(text);
  const hasExperience = /\b(?:experience|education)\s*:/i.test(text);
  const randomSlug = /-[0-9a-f]*\d[0-9a-f]{5,}$/i.test(candidate.slug);

  const noAudience = audience !== null && audience < MIN_AUDIENCE;
  const nothingElse = audience === null && !hasLocation && !hasExperience;
  const thin = noAudience || (nothingElse && candidate.snippet.length < 160);

  const parts: string[] = [];
  if (audience !== null) parts.push(`${audience} followers/connections`);
  parts.push(hasLocation ? 'location listed' : 'no location');
  parts.push(hasExperience ? 'experience listed' : 'no experience listed');
  if (randomSlug) parts.push('auto-generated profile URL');
  return { audience, hasLocation, hasExperience, randomSlug, thin, summary: parts.join(', ') };
}
