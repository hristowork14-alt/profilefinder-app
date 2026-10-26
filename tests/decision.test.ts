import { describe, expect, it } from 'vitest';
import { decideResults } from '../shared/decision';
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
});
