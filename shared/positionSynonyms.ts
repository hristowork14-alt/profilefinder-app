// Job-title synonym groups. Every title in a group is treated as equivalent.
// To add a role, add a new array (or a title to an existing one). The first entry
// of a group does not matter; matching is case- and punctuation-insensitive.

export const POSITION_SYNONYM_GROUPS: string[][] = [
  ['CEO', 'Chief Executive Officer', 'Founder', 'Co-Founder', 'Managing Director'],
  ['CTO', 'Chief Technology Officer', 'VP Engineering', 'Head of Engineering'],
  ['CFO', 'Chief Financial Officer', 'VP Finance', 'Finance Director', 'Head of Finance'],
  ['COO', 'Chief Operating Officer', 'VP Operations', 'Head of Operations'],
  ['CMO', 'Chief Marketing Officer'],
  ['Head of Marketing', 'VP Marketing', 'Marketing Director', 'CMO'],
  ['CPO', 'Chief Product Officer', 'VP Product', 'Head of Product'],
  ['CRO', 'Chief Revenue Officer', 'VP Sales', 'Head of Sales', 'Sales Director'],
  ['CISO', 'Chief Information Security Officer', 'Head of Security'],
  ['CIO', 'Chief Information Officer', 'IT Director', 'Head of IT'],
  ['HR', 'Head of HR', 'HR Director', 'Head of People', 'People & Culture', 'Talent Acquisition', 'CHRO'],
  ['Head of People', 'VP People', 'People Director', 'Head of Talent', 'HR Director'],
  ['Recruiter', 'Talent Acquisition', 'Talent Partner', 'Technical Recruiter'],
  ['Head of Design', 'Design Director', 'VP Design'],
  ['Head of Data', 'Chief Data Officer', 'Data Director', 'VP Data'],
  ['Head of Customer Success', 'VP Customer Success', 'Customer Success Director'],
];

/** Lowercase, punctuation-free form used for matching and as the cache key. */
export function normalizePosition(position: string): string {
  return position
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\.(?=\S)/g, '') // C.T.O. → cto
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Equivalent titles for a position, without the position itself. */
export function findSynonyms(position: string): string[] {
  const key = normalizePosition(position);
  if (!key) return [];
  const seen = new Set<string>([key]);
  const synonyms: string[] = [];
  for (const group of POSITION_SYNONYM_GROUPS) {
    if (!group.some((title) => normalizePosition(title) === key)) continue;
    for (const title of group) {
      const normalized = normalizePosition(title);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      synonyms.push(title);
    }
  }
  return synonyms;
}
