import { describe, expect, it } from 'vitest';
import { extractNamedPeople, namesMatch } from '../shared/corroboration';
import type { RankingContext, SearchHit } from '../shared/types';

// Fictional people in the real formats Google shows for "<Company> <role>" (dossier pages,
// press releases, company blog posts, job ads that only mention the role).
const ctx: RankingContext = { companyName: 'Northwind', domain: 'northwind.com', position: 'CTO', synonyms: ['Chief Technology Officer'] };

const hits: SearchHit[] = [
  {
    title: "Who is the CTO of Northwind in 2026? Mara Velin's Bio",
    snippet: 'Mara Velin is the Chief Technology Officer of Northwind. She joined in 2016 and leads engineering.',
    url: 'https://dossier.example/northwind-cto',
  },
  {
    title: 'Northwind names Mara Velin Chief Technology Officer - Business Wire',
    snippet:
      'SAN FRANCISCO — Northwind today announced that Mara Velin, who until today was SVP of Engineering, has become CTO. Former CTO Jon Hale-Smith joins the board.',
    url: 'https://news.example/northwind-cto',
  },
  {
    title: 'Chief of Staff to CTO - Northwind Careers',
    snippet: 'Join the Office of the CTO at Northwind. Apply Now. Remote, United States.',
    url: 'https://jobs.example/chief-of-staff',
  },
];

describe('extractNamedPeople', () => {
  it('finds the person named next to the role in several independent sources', () => {
    const people = extractNamedPeople(hits, ctx);
    expect(people[0]).toEqual({ name: 'Mara Velin', sources: 2 });
  });

  it('skips names introduced as former holders', () => {
    expect(extractNamedPeople(hits, ctx).map((p) => p.name)).not.toContain('Jon Hale-Smith');
  });

  it('never returns the company name, role words or page boilerplate as a person', () => {
    const names = extractNamedPeople(hits, ctx).map((p) => p.name);
    for (const junk of ['Chief Technology Officer', 'Business Wire', 'Northwind Careers', 'Apply Now', 'United States', 'Chief of Staff']) {
      expect(names).not.toContain(junk);
    }
  });

  it('returns nothing when no source names anyone', () => {
    expect(extractNamedPeople([hits[2]!], ctx)).toEqual([]);
  });

  it('handles non-ASCII names', () => {
    const people = extractNamedPeople(
      [
        { title: 'Northwind CTO Žofia Dvořáková', snippet: '', url: 'https://a.example' },
        { title: 'Interview: Žofia Dvořáková, CTO at Northwind', snippet: '', url: 'https://b.example' },
      ],
      ctx,
    );
    expect(people[0]).toEqual({ name: 'Žofia Dvořáková', sources: 2 });
  });
});

describe('namesMatch', () => {
  it('matches the same person regardless of case, accents and extra middle names', () => {
    expect(namesMatch('Mara Velin', 'mara velin')).toBe(true);
    expect(namesMatch('Zofia Dvorakova', 'Žofia Dvořáková')).toBe(true);
    expect(namesMatch('Mara J. Velin', 'Mara Velin')).toBe(true);
  });

  it('does not match different people who share one name', () => {
    expect(namesMatch('Mara Velin', 'Mara Stone')).toBe(false);
    expect(namesMatch('Jon Velin', 'Mara Velin')).toBe(false);
    expect(namesMatch('Mara', 'Mara Velin')).toBe(false);
  });
});
