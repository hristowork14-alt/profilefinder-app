import { describe, expect, it } from 'vitest';
import { closestMatches, decideResults } from '../shared/decision';
import type { Candidate, RankedProfile, VerifiedHolder } from '../shared/types';

const ctx = { companyName: 'Orbitly', domain: 'orbitly.com', position: 'CEO', synonyms: ['Chief Executive Officer'] };

const real: Candidate = {
  title: 'Andy Corwin - Orbitly | LinkedIn',
  snippet: 'President and CEO at Orbitly · Location: Seattle · 500+ connections',
  slug: 'andycorwin',
  linkedinUrl: 'https://www.linkedin.com/in/andycorwin',
};
const fake: Candidate = {
  title: 'zed fakeman - Chief Executive Officer at Orbitly | LinkedIn',
  snippet: 'Chief Executive Officer at Orbitly · 0 followers',
  slug: 'zed-fakeman-a13481385',
  linkedinUrl: 'https://www.linkedin.com/in/zed-fakeman-a13481385',
};
const holder: VerifiedHolder = {
  name: 'Andy Corwin',
  sources: 4,
  sourceLinks: [{ title: 'Leadership | Orbitly', url: 'https://ir.orbitly.com/l' }],
};
const ranked = (name: string, url: string, confidence: number): RankedProfile => ({
  fullName: name,
  headline: 'x',
  linkedinUrl: url,
  confidence,
  reasoning: 'r',
});

describe('decideResults', () => {
  it('verified holder with a matching profile: shows only that profile, marked verified', () => {
    const out = decideResults(
      [ranked('zed fakeman', fake.linkedinUrl, 60), ranked('Andy Corwin', real.linkedinUrl, 70)],
      [real, fake],
      holder,
      ctx,
    );
    expect(out.decision).toBe('verified_profile');
    expect(out.results.map((r) => r.fullName)).toEqual(['Andy Corwin']);
    expect(out.results[0]?.verified).toBe(true);
    expect(out.results[0]?.confidence).toBeGreaterThanOrEqual(75);
    expect(out.verifiedHolder).toEqual(holder);
  });

  it('adds the verified profile even when the ranker left it out', () => {
    const out = decideResults([ranked('zed fakeman', fake.linkedinUrl, 60)], [real, fake], holder, ctx);
    expect(out.results.map((r) => r.linkedinUrl)).toEqual([real.linkedinUrl]);
    expect(out.results[0]?.reasoning).toMatch(/4 independent sources/);
  });

  it('accepts a nickname form of the verified name', () => {
    const andrew = {
      ...real,
      title: 'Andrew Corwin - Orbitly | LinkedIn',
      slug: 'acorwin',
      linkedinUrl: 'https://www.linkedin.com/in/acorwin',
    };
    expect(decideResults([], [andrew], holder, ctx).results[0]?.linkedinUrl).toBe(andrew.linkedinUrl);
  });

  it('does not accept a namesake that never mentions the company or the role', () => {
    const namesake = { ...real, title: 'Andy Corwin - Plumber | LinkedIn', snippet: 'Plumbing in Leeds', slug: 'andy-corwin-77' };
    const out = decideResults([], [namesake], holder, ctx);
    expect(out.decision).toBe('verified_no_profile');
    expect(out.results).toEqual([]);
  });

  // Production 2026-10-26 (cloudflare.com + CTO): the real profile came back for the search
  // "<name>" "<company>", but its snippet named neither the company nor the role.
  it('accepts the verified name on a profile found by searching for the name together with the company', () => {
    const bare = { ...real, title: 'Andy Corwin | LinkedIn', snippet: 'Building things. Seattle.', foundWithCompany: true };
    const out = decideResults([], [bare], holder, ctx);
    expect(out.decision).toBe('verified_profile');
    expect(out.results[0]?.linkedinUrl).toBe(bare.linkedinUrl);
    // The same bare profile, found only by name, is still not enough.
    expect(decideResults([], [{ ...bare, foundWithCompany: false }], holder, ctx).decision).toBe('verified_no_profile');
  });

  // Production 2026-10-26 (imagga.com + CTO): sources named him, but Claude read his profile as
  // showing he had moved on — and the profile was still shown as "verified, 98".
  it('when Claude reads the matching profile as contradicting the sources, shows it unverified with its own score', () => {
    const doubt = {
      ...ranked('Andy Corwin', real.linkedinUrl, 30),
      reasoning: 'Now CTO at another company; Orbitly is in the past tense.',
    };
    const out = decideResults([doubt], [real], holder, ctx, { rankerReadProfiles: true });
    expect(out.decision).toBe('contradicted');
    expect(out.verifiedHolder).toBeNull();
    expect(out.results).toEqual([{ ...doubt, verified: false }]);
    // The heuristic ranker's low score is not a reading of the profile: it doesn't count as doubt.
    expect(decideResults([doubt], [real], holder, ctx).decision).toBe('verified_profile');
  });

  it('verified holder without a findable profile: no profiles at all, holder card only', () => {
    const out = decideResults([ranked('zed fakeman', fake.linkedinUrl, 20)], [fake], holder, ctx);
    expect(out.decision).toBe('verified_no_profile');
    expect(out.results).toEqual([]);
    expect(out.verifiedHolder).toEqual(holder);
  });

  it('no verified holder: keeps only results at 50+ and caps thin profiles below that', () => {
    const solid = {
      ...real,
      title: 'Mara Velin - CEO - Orbitly | LinkedIn',
      slug: 'maravelin',
      linkedinUrl: 'https://www.linkedin.com/in/maravelin',
    };
    const out = decideResults(
      [ranked('zed fakeman', fake.linkedinUrl, 85), ranked('Mara Velin', solid.linkedinUrl, 70), ranked('Low One', real.linkedinUrl, 40)],
      [fake, solid, real],
      null,
      ctx,
    );
    expect(out.decision).toBe('unverified');
    expect(out.results.map((r) => r.fullName)).toEqual(['Mara Velin']);
    expect(out.results[0]?.verified).toBe(false);
    expect(out.verifiedHolder).toBeNull();
  });

  it('no verified holder and nothing credible: no results', () => {
    const out = decideResults([ranked('zed fakeman', fake.linkedinUrl, 30)], [fake], null, ctx);
    expect(out.decision).toBe('no_results');
    expect(out.results).toEqual([]);
  });

  // Production 2026-10-27 (figma.com + Head of Design): sources were about her previous job, and
  // her LinkedIn headline already named another company — yet she was shown as "verified".
  it('when the matching profile names another current employer, shows it as conflicting, not verified', () => {
    const moved: Candidate = {
      ...real,
      title: 'Andy Corwin - Design at Quillstone | LinkedIn',
      snippet: 'Experience: Quillstone · Location: Seattle · 500+ connections',
      foundWithCompany: true,
    };
    const out = decideResults([ranked('Andy Corwin', real.linkedinUrl, 85)], [moved], holder, ctx, { rankerReadProfiles: true });
    expect(out.decision).toBe('contradicted');
    expect(out.verifiedHolder).toBeNull();
    expect(out.results[0]?.verified).toBe(false);
    expect(out.results[0]?.reasoning).toMatch(/Quillstone/);
    expect(out.results[0]?.confidence).toBeLessThan(75);
  });

  it('reads "@ Company" headlines too, and accepts a profile that lists this company among several', () => {
    const at: Candidate = {
      ...real,
      title: 'Andy Corwin - Co-founder & CTO @ Kelvin Labs | LinkedIn',
      snippet: 'Seattle',
      foundWithCompany: true,
    };
    expect(decideResults([], [at], holder, ctx).decision).toBe('contradicted');
    const several: Candidate = {
      ...real,
      title: 'Andy Corwin - CEO at Orbitly, NED at Netrisk | LinkedIn',
      snippet: 'Experience: Orbitly · Location: Seattle',
    };
    expect(decideResults([], [several], holder, ctx).decision).toBe('verified_profile');
  });

  it('does not accept a namesake who holds the role at another company', () => {
    const namesake: Candidate = { ...real, title: 'Andy Corwin - CEO at Plumbco | LinkedIn', snippet: 'Leeds', slug: 'andy-corwin-77' };
    const out = decideResults([], [namesake], holder, ctx);
    expect(out.decision).toBe('verified_no_profile');
    expect(out.results).toEqual([]);
  });

  // Production 2026-10-28 (imagga.com + CTO): he is CTO at both companies; the headline names the
  // other one first. That is a dual role, not a conflict.
  it('a profile that lists another employer and this company (not as past) is verified, working elsewhere too', () => {
    const dual: Candidate = {
      ...real,
      title: 'Andy Corwin - Co-founder & CTO @ Kelvin Labs | LinkedIn',
      snippet: 'Experience: Kelvin Labs · At Orbitly, I lead the AI team.',
      foundWithCompany: true,
    };
    const out = decideResults([], [dual], holder, ctx);
    expect(out.decision).toBe('verified_elsewhere');
    expect(out.results[0]?.verified).toBe(true);
    expect(out.verifiedHolder).toEqual(holder);
    const past: Candidate = { ...dual, snippet: 'Experience: Kelvin Labs · ex-Orbitly, previously led the AI team.' };
    expect(decideResults([], [past], holder, ctx).decision).toBe('contradicted');
  });

  // Production 2026-10-28 (cloudflare.com + CTO): the only profile with his exact name didn't
  // mention the company, so no link was shown at all.
  it('attaches the only exact-name profile for a verified person, clearly not as verified', () => {
    const onlyOne: Candidate = { ...real, title: 'Andy Corwin | LinkedIn', snippet: 'Austin, Texas', slug: 'acorwin' };
    const out = decideResults([], [onlyOne], holder, ctx, { nameOnlyProfile: onlyOne });
    expect(out.decision).toBe('verified_name_match');
    expect(out.verifiedHolder).toEqual(holder);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.verified).toBe(false);
    expect(out.results[0]?.reasoning).toMatch(/only LinkedIn profile with this exact name/);
    // Without it: as before.
    expect(decideResults([], [onlyOne], holder, ctx).decision).toBe('verified_no_profile');
  });

  // Production 2026-10-28 (absurdventures.com + CEO): one encyclopedia named the CEO.
  it('a holder named by one strong source is "likely": shown, never verified', () => {
    const one = { ...holder, sources: 1 };
    const noProfile = decideResults([], [fake], one, ctx, { likely: true });
    expect(noProfile.decision).toBe('likely');
    expect(noProfile.verifiedHolder).toEqual(one);
    expect(noProfile.results).toEqual([]);
    const withProfile = decideResults([ranked('Andy Corwin', real.linkedinUrl, 90)], [real], one, ctx, { likely: true });
    expect(withProfile.decision).toBe('likely');
    expect(withProfile.results[0]?.verified).toBe(false);
    expect(withProfile.results[0]?.confidence).toBeLessThan(75);
  });

  it('for roles many people hold, keeps ordinary short profiles and up to 25 results', () => {
    const many = { ...ctx, position: 'Mechanical Engineer', synonyms: [], manyHolders: true };
    const people: Candidate[] = Array.from({ length: 30 }, (_, i) => ({
      title: `Person ${i} - Mechanical Engineer at Orbitly | LinkedIn`,
      snippet: 'Zagreb',
      slug: `p-${i}`,
      linkedinUrl: `https://www.linkedin.com/in/p-${i}`,
    }));
    const rankedPeople = people.map((p, i) => ranked(`Person ${i}`, p.linkedinUrl, 70));
    const out = decideResults(rankedPeople, people, null, many, { manyHolders: true });
    expect(out.decision).toBe('unverified');
    expect(out.results).toHaveLength(25);
    // Single-holder roles still cap thin, possibly self-declared profiles.
    expect(decideResults(rankedPeople.slice(0, 3), people.slice(0, 3), null, ctx).results).toEqual([]);
  });
});

describe('closestMatches', () => {
  const many = { companyName: 'Orbitly', domain: 'orbitly.com', position: 'Mechanical Engineer', synonyms: [], manyHolders: true };
  const make = (i: number, title: string): Candidate => ({
    title,
    snippet: '',
    slug: `c-${i}`,
    linkedinUrl: `https://www.linkedin.com/in/c-${i}`,
  });

  it('offers people at the company with a related title, labelled as closest, below the credible line', () => {
    const out = closestMatches(
      [
        make(1, 'Ana Kos - Powertrain Engineer at Orbitly | LinkedIn'),
        make(2, 'Ivo Bar - Accountant at Orbitly | LinkedIn'),
        make(3, 'Jo Lee - Mechanical Engineer at Quillstone | LinkedIn'),
      ],
      many,
    );
    expect(out.map((r) => r.fullName)).toEqual(['Ana Kos']);
    expect(out[0]?.confidence).toBeLessThan(50);
    expect(out[0]?.reasoning).toMatch(/Closest match/);
    expect(out[0]?.verified).toBe(false);
  });

  it('returns nothing when nobody at the company has a related title', () => {
    expect(closestMatches([make(2, 'Ivo Bar - Accountant at Orbitly | LinkedIn')], many)).toEqual([]);
  });
});
