// Picks the web search provider from SEARCH_PROVIDER. To add one (e.g. Brave Search API),
// write an adapter like serper.ts that implements SearchProvider and add a case below.

import { createMockSearchProvider } from '../../../shared/mocks';
import type { SearchProvider } from '../../../shared/types';
import { ConfigError, type FunctionEnv } from './env';
import { createSerperProvider } from './serper';

export function createSearchProvider(env: FunctionEnv): SearchProvider {
  if (env.useMocks) return createMockSearchProvider();

  switch (env.searchProvider) {
    case 'serper':
      if (!env.serperApiKey) throw new ConfigError('SERPER_API_KEY is not set.');
      return createSerperProvider(env.serperApiKey);
    default:
      throw new ConfigError(`Unknown SEARCH_PROVIDER "${env.searchProvider}". Supported: serper.`);
  }
}
