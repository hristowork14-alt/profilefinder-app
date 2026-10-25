// Fixture homepage fetcher: returns canned HTML for the demo domains and behaves like an
// unreachable site for everything else (so the domain-name fallback is exercised).

import { sleep } from '../deadline';
import type { HomepageFetcher } from '../types';
import { FIXTURE_HOMEPAGES } from './fixtures';
import type { MockOptions } from './mockSearchProvider';

export function createMockHomepageFetcher(options: MockOptions = {}): HomepageFetcher {
  const scale = options.latencyScale ?? 1;
  return async (domain, signal) => {
    await sleep(300 * scale, signal);
    const html = FIXTURE_HOMEPAGES[domain];
    if (!html) throw new Error(`Mock homepage: ${domain} is not reachable in demo mode`);
    return html;
  };
}
