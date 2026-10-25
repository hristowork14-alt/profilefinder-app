import { describe, expect, it } from 'vitest';
import { domainToCompanyName, parseCompanyUrl } from '../shared/domain';

const domainOf = (input: string) => {
  const parsed = parseCompanyUrl(input);
  return parsed.ok ? parsed.domain : `ERROR: ${parsed.error}`;
};

describe('parseCompanyUrl', () => {
  it('extracts the root domain from full URLs', () => {
    expect(domainOf('https://www.acme.io/about')).toBe('acme.io');
    expect(domainOf('http://acme.io')).toBe('acme.io');
    expect(domainOf('https://acme.io/?ref=x#top')).toBe('acme.io');
  });

  it('accepts input without a scheme or with www', () => {
    expect(domainOf('acme.io')).toBe('acme.io');
    expect(domainOf('www.acme.io')).toBe('acme.io');
    expect(domainOf('  ACME.IO  ')).toBe('acme.io');
    expect(domainOf('stripe.com/en-bg')).toBe('stripe.com');
  });

  it('reduces subdomains to the registrable domain', () => {
    expect(domainOf('https://app.stripe.com/login')).toBe('stripe.com');
    expect(domainOf('blog.acme.io')).toBe('acme.io');
  });

  it('keeps multi-part public suffixes intact', () => {
    expect(domainOf('https://www.acme.co.uk')).toBe('acme.co.uk');
    expect(domainOf('shop.acme.com.au')).toBe('acme.com.au');
    expect(domainOf('mycompany.github.io')).toBe('mycompany.github.io');
    expect(domainOf('demo.netlify.app')).toBe('demo.netlify.app');
  });

  it('handles fictional demo domains and hyphens', () => {
    expect(domainOf('nimbus-labs.example')).toBe('nimbus-labs.example');
  });

  it('rejects invalid input with a clear message', () => {
    for (const bad of [
      '',
      '   ',
      'not a url',
      'localhost',
      'http://localhost:3000',
      '127.0.0.1',
      'https://10.0.0.1/x',
      'acme',
      '-acme.io',
      'acme-.io',
      'acme..io',
      'ftp://acme.io',
      'acme.i',
      'user:pass@acme.io',
    ]) {
      const parsed = parseCompanyUrl(bad);
      expect(parsed.ok, `expected "${bad}" to be rejected`).toBe(false);
      if (!parsed.ok) expect(parsed.error.length).toBeGreaterThan(10);
    }
  });

  it('rejects overly long input', () => {
    expect(parseCompanyUrl(`https://${'a'.repeat(600)}.com`).ok).toBe(false);
  });
});

describe('domainToCompanyName', () => {
  it('capitalizes the domain label', () => {
    expect(domainToCompanyName('acme.io')).toBe('Acme');
    expect(domainToCompanyName('stripe.com')).toBe('Stripe');
    expect(domainToCompanyName('my-company.co.uk')).toBe('My Company');
    expect(domainToCompanyName('nimbus-labs.example')).toBe('Nimbus Labs');
    expect(domainToCompanyName('mycompany.github.io')).toBe('Mycompany');
  });
});
