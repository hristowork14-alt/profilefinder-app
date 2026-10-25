import { describe, expect, it } from 'vitest';
import { normalizeLinkedInProfileUrl } from '../shared/linkedinUrl';

const norm = (url: string) => normalizeLinkedInProfileUrl(url)?.url ?? null;

describe('normalizeLinkedInProfileUrl', () => {
  it('normalizes standard profile URLs', () => {
    expect(norm('https://www.linkedin.com/in/jane-doe')).toBe('https://www.linkedin.com/in/jane-doe');
    expect(norm('https://www.linkedin.com/in/jane-doe/')).toBe('https://www.linkedin.com/in/jane-doe');
    expect(norm('http://linkedin.com/in/jane-doe')).toBe('https://www.linkedin.com/in/jane-doe');
  });

  it('accepts country subdomains and strips query strings and fragments', () => {
    expect(norm('https://bg.linkedin.com/in/jane-doe-12345?trk=public_profile')).toBe('https://www.linkedin.com/in/jane-doe-12345');
    expect(norm('https://uk.linkedin.com/in/Jane-Doe#experience')).toBe('https://www.linkedin.com/in/jane-doe');
  });

  it('strips locale suffixes', () => {
    expect(norm('https://www.linkedin.com/in/jane-doe/de')).toBe('https://www.linkedin.com/in/jane-doe');
    expect(norm('https://www.linkedin.com/in/jane-doe/en-us/')).toBe('https://www.linkedin.com/in/jane-doe');
  });

  it('keeps encoded non-ASCII slugs', () => {
    const result = normalizeLinkedInProfileUrl('https://fr.linkedin.com/in/j%C3%A9r%C3%B4me-dupont');
    expect(result?.url).toBe('https://www.linkedin.com/in/j%C3%A9r%C3%B4me-dupont');
    expect(result?.slug).toBe('jérôme-dupont');
  });

  it('returns a lowercase slug for deduplication', () => {
    expect(normalizeLinkedInProfileUrl('https://www.linkedin.com/in/Jane-DOE')?.slug).toBe('jane-doe');
  });

  it('rejects non-profile LinkedIn pages and other sites', () => {
    for (const bad of [
      'https://www.linkedin.com/company/acme',
      'https://www.linkedin.com/posts/jane-doe_activity-123',
      'https://www.linkedin.com/jobs/view/123',
      'https://www.linkedin.com/in/',
      'https://www.linkedin.com/pub/jane-doe/1/2/3',
      'https://evil-linkedin.com/in/jane-doe',
      'https://linkedin.com.evil.io/in/jane-doe',
      'https://example.com/in/jane-doe',
      'javascript:alert(1)',
      'not a url',
      'https://www.linkedin.com/in/a',
    ]) {
      expect(norm(bad), bad).toBeNull();
    }
  });
});
