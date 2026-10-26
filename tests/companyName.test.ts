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

  // Real homepage titles that produced a slogan as the "company name" in production.
  it('splits on a colon without a space before it', () => {
    expect(resolveCompanyName('<title>Cloudflare: Build for the agent era</title>', 'cloudflare.com')).toEqual({
      name: 'Cloudflare',
      source: 'title',
    });
  });

  it('splits sentence-style titles and drops the domain suffix from the name', () => {
    expect(resolveCompanyName('<title>Amazon.com. Spend less. Smile more.</title>', 'amazon.com').name).toBe('Amazon');
    expect(resolveCompanyName('<title>Acme.io | Tools for builders</title>', 'acme.io').name).toBe('Acme');
  });

  it('does not split abbreviations such as "Dr." or "St."', () => {
    expect(resolveCompanyName('<title>Dr. Oetker | Recipes</title>', 'oetker.com').name).toBe('Dr. Oetker');
  });

  it('falls back to the domain when no segment names the company and the title reads like a slogan', () => {
    expect(resolveCompanyName('<title>Spend less on every order you place today</title>', 'shopco.com')).toEqual({
      name: 'Shopco',
      source: 'domain',
    });
  });

  it('keeps a short, non-matching title segment (brand differs from domain)', () => {
    expect(resolveCompanyName('<title>Mailchimp | Marketing, Automation</title>', 'intuit-mc.com').name).toBe('Mailchimp');
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
