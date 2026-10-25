// Fixture data for demo / USE_MOCKS mode. Everything here is fictional.
// Profile slugs start with "pf-demo-" so they can never be mistaken for real people.

import { domainToCompanyName } from '../domain';
import { findSynonyms, normalizePosition } from '../positionSynonyms';
import { createRandom, pick } from './random';

/** Homepages the mock "fetches". Any other domain behaves like an unreachable site. */
export const FIXTURE_HOMEPAGES: Record<string, string> = {
  'nimbus-labs.example':
    '<html><head><meta property="og:site_name" content="Nimbus Labs"><title>Nimbus Labs — Cloud robotics for warehouses</title></head></html>',
  'quietpine.example': '<html><head><title>Home | Quiet Pine</title></head></html>',
  'brightloop.example': '<html><head><title>Welcome to Brightloop</title></head></html>',
  'flaky-ai.example': '<html><head><meta property="og:site_name" content="Flaky AI"><title>Flaky AI</title></head></html>',
};

/** Special demo domains that show edge cases. Listed on the search page in demo mode. */
export const DEMO_SCENARIOS = [
  { domain: 'nimbus-labs.example', position: 'CTO', note: 'Company name read from the homepage (og:site_name)' },
  { domain: 'quietpine.example', position: 'Head of Marketing', note: 'Name cleaned from the page title "Home | Quiet Pine"' },
  { domain: 'northwind-freight.example', position: 'CFO', note: 'Homepage not reachable → name from the domain. Run it twice → cache' },
  { domain: 'flaky-ai.example', position: 'CEO', note: 'Model returns broken JSON twice → heuristic fallback' },
  { domain: 'empty.example', position: 'CTO', note: 'No profiles found → friendly empty state' },
  { domain: 'search-down.example', position: 'CTO', note: 'Search API fails → error message' },
] as const;

export const EMPTY_COMPANY_KEY = 'empty';
export const SEARCH_DOWN_COMPANY_KEY = 'searchdown';
export const FLAKY_DOMAIN = 'flaky-ai.example';

const FIRST_NAMES = [
  'Maria',
  'Georgi',
  'Elena',
  'Nikolay',
  'Sofia',
  'Daniel',
  'Iva',
  'Martin',
  'Laura',
  'Viktor',
  'Nadia',
  'Petar',
  'Clara',
  'Jonas',
  'Amira',
  'Lukas',
  'Priya',
  'Tomas',
  'Hana',
  'Mateo',
  'Yana',
  'Oliver',
  'Ines',
  'Kaloyan',
] as const;
const LAST_NAMES = [
  'Ivanova',
  'Petrov',
  'Dimitrova',
  'Kostov',
  'Hart',
  'Novak',
  'Lindqvist',
  'Moreau',
  'Rossi',
  'Keller',
  'Okafor',
  'Sato',
  'Varga',
  'Silva',
  'Haddad',
  'Berg',
  'Popescu',
  'Kowalski',
  'Andersen',
  'Marin',
  'Stoyanova',
  'Georgiev',
] as const;
const CITIES = [
  'Sofia, Bulgaria',
  'Berlin, Germany',
  'London, United Kingdom',
  'Lisbon, Portugal',
  'Amsterdam, Netherlands',
  'Plovdiv, Bulgaria',
  'Warsaw, Poland',
] as const;
const OTHER_COMPANIES = ['Orbitly', 'Cedarline', 'Vantor', 'Helix & Co', 'Northgate', 'Kitebase', 'Marlowe Systems'] as const;

/** "Nimbus Labs" / "nimbus-labs.example" → "nimbuslabs" */
export function companyKeyFromTerm(term: string): string {
  const looksLikeDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(term);
  const base = looksLikeDomain ? domainToCompanyName(term) : term;
  return base.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function displayNameFromTerm(term: string): string {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(term) ? domainToCompanyName(term) : term;
}

/** Same people come back for "CTO" and "Chief Technology Officer". */
export function roleKey(position: string): string {
  const all = [position, ...findSynonyms(position)].map(normalizePosition).filter(Boolean);
  return all.sort()[0] ?? normalizePosition(position);
}

export interface FixturePerson {
  slug: string;
  name: string;
  city: string;
  other: string;
}

/** Six fictional people for a company + role, always the same for the same input. */
export function fixturePeople(companyKey: string, position: string): FixturePerson[] {
  const random = createRandom(`${companyKey}|${roleKey(position)}`);
  const used = new Set<string>();
  const people: FixturePerson[] = [];
  while (people.length < 6) {
    const first = pick(random, FIRST_NAMES);
    const last = pick(random, LAST_NAMES);
    if (used.has(first) || used.has(last)) continue;
    used.add(first);
    used.add(last);
    const suffix = Math.floor(random() * 0xffff)
      .toString(16)
      .padStart(4, '0');
    people.push({
      slug: `pf-demo-${first}-${last}-${suffix}`.toLowerCase(),
      name: `${first} ${last}`,
      city: pick(random, CITIES),
      other: pick(random, OTHER_COMPANIES),
    });
  }
  return people;
}
