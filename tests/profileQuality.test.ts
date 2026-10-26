import { describe, expect, it } from 'vitest';
import { profileSignals } from '../shared/profileQuality';
import type { Candidate } from '../shared/types';

const candidate = (title: string, snippet: string, slug: string): Candidate => ({
  title,
  snippet,
  slug,
  linkedinUrl: `https://www.linkedin.com/in/${slug}`,
});

describe('profileSignals', () => {
  it('flags self-declared looking profiles: almost no followers, nothing else listed', () => {
    const s = profileSignals(
      candidate(
        'zed fakeman - Chief Executive Officer at Orbitly | LinkedIn',
        'Chief Executive Officer at Orbitly · 0 followers',
        'zed-fakeman-a13481385',
      ),
    );
    expect(s.audience).toBe(0);
    expect(s.randomSlug).toBe(true);
    expect(s.thin).toBe(true);
    expect(s.summary).toMatch(/0 followers/);
  });

  it('does not flag an established profile', () => {
    const s = profileSignals(
      candidate(
        'Andy Corwin - Orbitly | LinkedIn',
        'President and CEO at Orbitly · Experience: Orbitly · Education: State University · Location: Seattle · 500+ connections on LinkedIn.',
        'andycorwin',
      ),
    );
    expect(s.audience).toBe(500);
    expect(s.hasLocation).toBe(true);
    expect(s.hasExperience).toBe(true);
    expect(s.randomSlug).toBe(false);
    expect(s.thin).toBe(false);
  });

  it('reads follower counts like 10K and 1.2M', () => {
    expect(profileSignals(candidate('A B - X | LinkedIn', '10K followers', 'ab')).audience).toBe(10_000);
    expect(profileSignals(candidate('A B - X | LinkedIn', '1.2M followers · 500+ connections', 'ab')).audience).toBe(1_200_000);
  });

  it('is not thin just because the snippet is short, if the profile has a real audience', () => {
    expect(profileSignals(candidate('A B - X | LinkedIn', '2K followers', 'a-b-1234')).thin).toBe(false);
  });

  it('treats a short snippet with no audience, location or experience as thin', () => {
    expect(profileSignals(candidate('A B - CTO at X | LinkedIn', 'CTO at X', 'a-b-57a92138b')).thin).toBe(true);
  });
});
