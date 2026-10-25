// Serper.dev (Google Search API) adapter. Docs: https://serper.dev
// POST https://google.serper.dev/search  {"q": "...", "num": 10}  →  { organic: [{ title, link, snippet }] }

import { z } from 'zod';
import type { SearchHit, SearchProvider } from '../../../shared/types';

const SERPER_URL = 'https://google.serper.dev/search';

const SerperResponse = z.object({
  organic: z
    .array(
      z.object({
        title: z.string().optional(),
        link: z.string().optional(),
        snippet: z.string().optional(),
      }),
    )
    .optional(),
});

export class SearchProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SearchProviderError';
  }
}

export function createSerperProvider(apiKey: string, fetchImpl: typeof fetch = fetch): SearchProvider {
  return {
    name: 'serper',
    async search(query, { signal, limit }) {
      const response = await fetchImpl(SERPER_URL, {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: Math.min(Math.max(limit, 1), 20) }),
        signal,
      });
      if (!response.ok) {
        // 401/403 = bad key, 429 = out of credits / rate limited. Body is not logged (may echo the query).
        throw new SearchProviderError(`Serper returned HTTP ${response.status}`, response.status);
      }
      const parsed = SerperResponse.safeParse(await response.json());
      if (!parsed.success) throw new SearchProviderError('Serper returned an unexpected response');

      const hits: SearchHit[] = [];
      for (const item of parsed.data.organic ?? []) {
        if (!item.link) continue;
        hits.push({ title: item.title ?? '', snippet: item.snippet ?? '', url: item.link });
      }
      return hits.slice(0, limit);
    },
  };
}
