// Turns whatever the user typed ("https://www.acme.io/about", "acme.io", "WWW.ACME.IO")
// into a clean registrable domain ("acme.io"), or explains why it can't.

export type ParsedCompanyUrl = { ok: true; domain: string; hostname: string } | { ok: false; error: string };

const MAX_INPUT_LENGTH = 500;

/**
 * Suffixes under which each label belongs to a different owner. Not the full Public Suffix
 * List — just the common ones — so "app.acme.co.uk" → "acme.co.uk" and
 * "team.github.io" stays as is. Extend if you need more.
 */
const MULTI_PART_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'ltd.uk',
  'plc.uk',
  'me.uk',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'co.nz',
  'org.nz',
  'co.jp',
  'ne.jp',
  'or.jp',
  'co.kr',
  'co.in',
  'firm.in',
  'net.in',
  'org.in',
  'com.br',
  'com.mx',
  'com.ar',
  'com.co',
  'com.tr',
  'com.cn',
  'com.hk',
  'com.sg',
  'com.my',
  'com.ph',
  'com.tw',
  'co.za',
  'co.il',
  'co.id',
  'co.th',
  'com.ua',
  'com.pl',
  'com.ro',
  'com.gr',
  'com.cy',
  'com.mt',
  'com.pt',
  'com.es',
  'github.io',
  'gitlab.io',
  'netlify.app',
  'vercel.app',
  'pages.dev',
  'web.app',
  'firebaseapp.com',
  'herokuapp.com',
  'azurewebsites.net',
  'cloudfront.net',
  'wordpress.com',
  'wixsite.com',
  'squarespace.com',
  'myshopify.com',
  'webflow.io',
  'framer.website',
  'lovable.app',
  'replit.app',
  'onrender.com',
]);

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export function parseCompanyUrl(rawInput: string): ParsedCompanyUrl {
  const input = (rawInput ?? '').trim();
  if (!input) return { ok: false, error: 'Please enter the company website, e.g. stripe.com.' };
  if (input.length > MAX_INPUT_LENGTH)
    return { ok: false, error: 'That address is too long. Enter just the company website, e.g. stripe.com.' };
  if (/\s/.test(input)) return { ok: false, error: 'A website address cannot contain spaces. Try something like stripe.com.' };

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
  if (hasScheme && !/^https?:\/\//i.test(input)) {
    return { ok: false, error: 'Only http:// or https:// website addresses are supported.' };
  }

  let url: URL;
  try {
    url = new URL(hasScheme ? input : `https://${input}`);
  } catch {
    return { ok: false, error: 'That does not look like a website address. Try something like stripe.com.' };
  }

  if (url.username || url.password) return { ok: false, error: 'Website addresses with a username or password are not supported.' };
  if (url.port) return { ok: false, error: 'Please enter the public company website without a port number.' };

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('[')) {
    return { ok: false, error: 'Please enter a website name (like stripe.com), not an IP address.' };
  }

  const labels = hostname.split('.');
  if (labels.length < 2) return { ok: false, error: 'Please include the full domain, e.g. acme.io rather than acme.' };
  if (!labels.every((label) => LABEL.test(label))) {
    return { ok: false, error: 'That website address contains invalid characters. Try something like stripe.com.' };
  }
  const tld = labels[labels.length - 1] ?? '';
  if (!TLD.test(tld)) return { ok: false, error: 'That domain ending is not valid. Try something like stripe.com.' };

  const domain = toRegistrableDomain(labels.filter((label, i) => !(i === 0 && label === 'www' && labels.length > 2)));
  if (domain.length > 253) return { ok: false, error: 'That domain is too long.' };
  return { ok: true, domain, hostname };
}

function toRegistrableDomain(labels: string[]): string {
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  const keep = MULTI_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

/** "my-company.co.uk" → "My Company". Used when the homepage gives us nothing better. */
export function domainToCompanyName(domain: string): string {
  const labels = domain.toLowerCase().split('.');
  const lastTwo = labels.slice(-2).join('.');
  const nameLabel = labels.length > 2 && MULTI_PART_SUFFIXES.has(lastTwo) ? labels[labels.length - 3] : labels[0];
  return (nameLabel ?? domain)
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
