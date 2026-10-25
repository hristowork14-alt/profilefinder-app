// Fetches a company's homepage HTML so its name can be read (og:site_name / <title>).
// Safety rules: https only, no IP addresses, never linkedin.com (not even via a redirect),
// at most 5 redirects, a size cap, and a browser-like User-Agent.

import { parseCompanyUrl } from '../../../shared/domain';
import type { HomepageFetcher } from '../../../shared/types';

const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

export class HomepageError extends Error {}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'linkedin.com' || host.endsWith('.linkedin.com') || host === 'lnkd.in' || host.endsWith('.licdn.com');
}

function assertFetchable(url: URL): void {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new HomepageError(`Refusing ${url.protocol} URL`);
  if (url.username || url.password || url.port) throw new HomepageError('Refusing URL with credentials or a port');
  if (isBlockedHost(url.hostname)) throw new HomepageError('Refusing to fetch linkedin.com');
  if (!parseCompanyUrl(url.hostname).ok) throw new HomepageError(`Refusing host ${url.hostname}`);
}

async function readLimited(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const bytes = new Uint8Array(Math.min(total, MAX_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, Math.min(chunk.byteLength, bytes.length - offset));
    bytes.set(slice, offset);
    offset += slice.byteLength;
    if (offset >= bytes.length) break;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function createHomepageFetcher(fetchImpl: typeof fetch = fetch): HomepageFetcher {
  return async (domain, signal) => {
    let url = new URL(`https://${domain}/`);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      assertFetchable(url);
      const response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'en' },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!location) throw new HomepageError(`Redirect without location from ${url.hostname}`);
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new HomepageError(`HTTP ${response.status} from ${url.hostname}`);
      }
      const type = response.headers.get('content-type') ?? '';
      if (type && !/html|xml/i.test(type)) {
        await response.body?.cancel().catch(() => {});
        throw new HomepageError(`Not an HTML page (${type})`);
      }
      return readLimited(response);
    }
    throw new HomepageError('Too many redirects');
  };
}
