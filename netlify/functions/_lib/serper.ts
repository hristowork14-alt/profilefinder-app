// Serper.dev (Google Search API) adapter. Docs: https://serper.dev
// POST https://google.serper.dev/search  {"q": "...", "num": 10}
//   → { organic: [{ title, link, snippet }], answerBox?, knowledgeGraph?, peopleAlsoAsk? }

import { z } from 'zod';
import type { SearchHit, SearchProvider } from '../../../shared/types';

const SERPER_URL = 'https://google.serper.dev/search';
/** Placeholder source URL for the knowledge graph panel, which has no single link. */
const KNOWLEDGE_GRAPH_URL = 'https://serper.dev/knowledge-graph';

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
  // Google's direct-answer features. Most useful for "<Company> <role>" evidence queries; for
  // site:linkedin.com/in queries they're rare, and non-LinkedIn URLs are filtered out anyway.
  answerBox: z
    .object({ title: z.string().optional(), answer: z.string().optional(), snippet: z.string().optional(), link: z.string().optional() })
    .optional()
    .catch(undefined),
  knowledgeGraph: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      attributes: z.record(z.string(), z.string()).optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
  peopleAlsoAsk: z
    .array(z.object({ question: z.string().optional(), snippet: z.string().optional(), link: z.string().optional() }))
    .optional()
    .catch(undefined),
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

type Parsed = z.infer<typeof SerperResponse>;

/** Answer box, knowledge graph and "People also ask", as hits. They never replace organic results. */
function extraHits(data: Parsed): SearchHit[] {
  const extras: SearchHit[] = [];
  const box = data.answerBox;
  if (box && (box.answer || box.snippet) && box.link) {
    const snippet = [box.answer, box.snippet].filter(Boolean).join(' — ');
    extras.push({ title: box.title ?? '', snippet, url: box.link });
  }
  const graph = data.knowledgeGraph;
  if (graph?.title) {
    const attributes = Object.entries(graph.attributes ?? {}).map(([key, value]) => `${key}: ${value}`);
    const snippet = [graph.description?.replace(/\.\s*$/, ''), ...attributes].filter(Boolean).join('. ');
    if (snippet) extras.push({ title: graph.title, snippet, url: KNOWLEDGE_GRAPH_URL });
  }
  for (const item of data.peopleAlsoAsk ?? []) {
    if (item.snippet && item.link) extras.push({ title: item.question ?? '', snippet: item.snippet, url: item.link });
  }
  return extras;
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
      return [...hits.slice(0, limit), ...extraHits(parsed.data)];
    },
  };
}
