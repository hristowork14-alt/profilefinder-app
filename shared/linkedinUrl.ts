// Recognizes public LinkedIn profile URLs (linkedin.com/in/<slug>, any country subdomain)
// and normalizes them to https://www.linkedin.com/in/<slug>.
// This only parses strings returned by the search API — the app never requests linkedin.com.

export interface NormalizedProfileUrl {
  url: string;
  /** Decoded, lowercase slug — the de-duplication key. */
  slug: string;
}

const LOCALE_SEGMENT = /^[a-z]{2}(?:[-_][a-z]{2})?$/i;

export function normalizeLinkedInProfileUrl(raw: string): NormalizedProfileUrl | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0]?.toLowerCase() !== 'in' || !segments[1]) return null;
  // Allow at most one extra segment, and only if it is a locale like "de" or "en-us".
  if (segments.length > 3 || (segments[2] !== undefined && !LOCALE_SEGMENT.test(segments[2]))) return null;

  let slug: string;
  try {
    slug = decodeURIComponent(segments[1]).toLowerCase();
  } catch {
    return null;
  }
  if (slug.length < 3 || slug.length > 100) return null;
  if (!/^[\p{L}\p{N}_-]+$/u.test(slug)) return null;

  return { url: `https://www.linkedin.com/in/${encodeURIComponent(slug)}`, slug };
}
