import { describe, expect, it } from 'vitest';
import { evidenceRoleTerms, extractNamedPeople, nameVariants, namesMatch } from '../shared/corroboration';
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
    expect(people[0]).toMatchObject({ name: 'Mara Velin', sources: 2 });
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
    expect(people[0]).toMatchObject({ name: 'Žofia Dvořáková', sources: 2 });
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

  // Production: sources said "Andy …" while a profile may say "Andrew …" (and vice versa).
  it('matches common nickname forms of the first name', () => {
    expect(namesMatch('Andy Corwin', 'Andrew Corwin')).toBe(true);
    expect(namesMatch('Bill Ostrander', 'William Ostrander')).toBe(true);
    expect(namesMatch('Ellie Marsh', 'Elinor Marsh')).toBe(true);
    expect(namesMatch('Kate Brennan', 'Katherine Brennan')).toBe(true);
    expect(namesMatch('Andy Corwin', 'Andrea Corwin')).toBe(false);
  });

  it('handles "Last, First", initials and possessives', () => {
    expect(namesMatch('Corwin, Andy', 'Andy Corwin')).toBe(true);
    expect(namesMatch('Andy R. Corwin', 'Andy Corwin')).toBe(true);
    expect(namesMatch("Mara Velin's", 'Mara Velin')).toBe(true);
  });
});

describe('evidenceRoleTerms', () => {
  it('keeps only exact equivalents (abbreviation ↔ full title), not looser related titles', () => {
    expect(evidenceRoleTerms('CEO', ['Chief Executive Officer', 'Founder', 'Co-Founder', 'Managing Director'])).toEqual([
      'CEO',
      'Chief Executive Officer',
    ]);
    expect(evidenceRoleTerms('Chief Financial Officer', ['CFO', 'VP Finance', 'Finance Director'])).toEqual([
      'Chief Financial Officer',
      'CFO',
    ]);
    expect(evidenceRoleTerms('Head of Engineering', ['CTO', 'Chief Technology Officer', 'VP Engineering'])).toEqual([
      'Head of Engineering',
    ]);
  });

  it('does not count a founder as the CEO', () => {
    const people = extractNamedPeople(
      [
        { title: 'Orbitly founder Jeff Hale', snippet: 'Jeff Hale founded Orbitly in 1994.', url: 'https://a.example' },
        { title: 'Jeff Hale, Orbitly Founder', snippet: '', url: 'https://b.example' },
      ],
      { companyName: 'Orbitly', domain: 'orbitly.com', position: 'CEO', synonyms: ['Chief Executive Officer', 'Founder'] },
    );
    expect(people).toEqual([]);
  });
});

describe('nameVariants', () => {
  it('lists the other common forms of a first name, keeping the last name', () => {
    expect(nameVariants('Andy Corwin')).toEqual(['Andrew Corwin']);
    expect(nameVariants('William Ostrander')).toEqual(expect.arrayContaining(['Bill Ostrander', 'Will Ostrander']));
    expect(nameVariants('Mara Velin')).toEqual([]);
  });
});

describe('extractNamedPeople: weighting, recency and links', () => {
  const amazonLike: RankingContext = {
    companyName: 'Orbitly',
    domain: 'orbitly.com',
    position: 'CEO',
    synonyms: ['Chief Executive Officer'],
  };

  it('counts a source on the company’s own domain double, and returns up to 3 source links', () => {
    const people = extractNamedPeople(
      [
        { title: 'Leadership | Orbitly', snippet: 'Andy Corwin, President and CEO', url: 'https://ir.orbitly.com/leadership' },
        { title: 'Orbitly CEO Andy Corwin on AI', snippet: '', url: 'https://news.example/a' },
      ],
      amazonLike,
    );
    expect(people[0]?.name).toBe('Andy Corwin');
    expect(people[0]?.sources).toBe(3);
    expect(people[0]?.links?.[0]).toEqual({ title: 'Leadership | Orbitly', url: 'https://ir.orbitly.com/leadership' });
  });

  it('counts the same page once even if several queries return it', () => {
    const hit = { title: 'Orbitly CEO Andy Corwin', snippet: '', url: 'https://news.example/a' };
    expect(extractNamedPeople([hit, hit, { ...hit, url: 'https://news.example/b' }], amazonLike)[0]?.sources).toBe(2);
  });

  it('does not count someone described as the former holder, even after their name', () => {
    const people = extractNamedPeople(
      [
        {
          title: 'Andy Corwin succeeded Jeff Hale as Orbitly CEO',
          snippet: 'Jeff Hale, former CEO of Orbitly, founded the company.',
          url: 'https://a.example',
        },
        { title: 'Orbitly CEO Andy Corwin', snippet: 'Jeff Hale, the ex-CEO, is now executive chair.', url: 'https://b.example' },
      ],
      amazonLike,
    );
    expect(people.map((p) => p.name)).toEqual(['Andy Corwin']);
  });
});
