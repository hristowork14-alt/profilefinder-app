import { describe, expect, it } from 'vitest';
import { resolveCompanyName } from '../shared/companyName';

describe('resolveCompanyName', () => {
  it('prefers og:site_name', () => {
    const html =
      '<html><head><meta property="og:site_name" content="Stripe"><title>Stripe | Financial Infrastructure</title></head></html>';
    expect(resolveCompanyName(html, 'stripe.com')).toEqual({ name: 'Stripe', source: 'og:site_name' });
  });

  it('handles reversed attribute order and name= variant', () => {
    expect(resolveCompanyName('<meta content="Acme Corp" property="og:site_name" />', 'acme.io').name).toBe('Acme Corp');
    expect(resolveCompanyName("<meta name='og:site_name' content='Nimbus Labs'>", 'nimbus.io').name).toBe('Nimbus Labs');
  });

  it('cleans taglines from the <title>', () => {
    expect(resolveCompanyName('<title>Acme | Home</title>', 'acme.io')).toEqual({ name: 'Acme', source: 'title' });
    expect(resolveCompanyName('<title>Home - Acme</title>', 'acme.io').name).toBe('Acme');
    expect(resolveCompanyName('<title>Welcome to Acme</title>', 'acme.io').name).toBe('Acme');
    expect(resolveCompanyName('<title>Stripe | Financial Infrastructure for the Internet</title>', 'stripe.com').name).toBe('Stripe');
  });

  it('picks the title segment that matches the domain', () => {
    expect(resolveCompanyName('<title>Payments made simple – Paylane</title>', 'paylane.com').name).toBe('Paylane');
  });

  it('decodes HTML entities', () => {
    expect(resolveCompanyName('<title>Smith &amp; Sons | Home</title>', 'smithandsons.com').name).toBe('Smith & Sons');
    expect(resolveCompanyName('<meta property="og:site_name" content="Ben &#39;n&#x27; Co">', 'ben.co').name).toBe("Ben 'n' Co");
  });

  it('falls back to the capitalized domain', () => {
    expect(resolveCompanyName(null, 'my-company.io')).toEqual({ name: 'My Company', source: 'domain' });
    expect(resolveCompanyName('<html><title></title></html>', 'acme.io')).toEqual({ name: 'Acme', source: 'domain' });
    expect(resolveCompanyName('<title>Home</title>', 'acme.io')).toEqual({ name: 'Acme', source: 'domain' });
  });

  it('ignores absurdly long values', () => {
    const long = 'x'.repeat(300);
    expect(resolveCompanyName(`<meta property="og:site_name" content="${long}"><title>${long}</title>`, 'acme.io').source).toBe('domain');
  });
});
