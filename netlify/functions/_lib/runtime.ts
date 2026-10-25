// Wires the real (or mock, with USE_MOCKS=true) dependencies from environment variables.

import { createMockHomepageFetcher, createMockLlmClient } from '../../../shared/mocks';
import type { PipelineDeps } from '../../../shared/pipeline';
import { createAnthropicClient } from './anthropicClient';
import { createHomepageFetcher } from './companyResolver';
import type { FunctionEnv } from './env';
import { createSearchProvider } from './searchProvider';

export const log = (message: string) => console.log(`[profilefinder] ${message}`);

export function createPipelineDeps(env: FunctionEnv): PipelineDeps {
  if (env.useMocks) {
    return {
      searchProvider: createSearchProvider(env),
      fetchHomepage: createMockHomepageFetcher(),
      llm: createMockLlmClient(),
    };
  }
  return {
    searchProvider: createSearchProvider(env),
    fetchHomepage: createHomepageFetcher(),
    // No key → the heuristic ranker is used automatically.
    llm: env.anthropicApiKey ? createAnthropicClient(env.anthropicApiKey, env.anthropicModel, env.anthropicEffort) : null,
  };
}
