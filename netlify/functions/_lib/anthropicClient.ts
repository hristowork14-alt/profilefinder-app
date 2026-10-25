// Real Claude client behind the LlmClient interface. Model comes from ANTHROPIC_MODEL.
// Current model IDs: https://platform.claude.com/docs/en/about-claude/models/overview

import Anthropic from '@anthropic-ai/sdk';
import type { LlmClient } from '../../../shared/types';

export type Effort = 'low' | 'medium' | 'high';

export function createAnthropicClient(apiKey: string, model: string, effort: Effort | null = 'low'): LlmClient {
  // maxRetries: 0 — the pipeline has its own time budget and fallback; SDK retries would blow it.
  const client = new Anthropic({ apiKey, maxRetries: 0 });

  return {
    async complete({ system, prompt, maxTokens, timeoutMs, signal }) {
      try {
        const message = await client.messages.create(
          {
            model,
            // Current models think adaptively; thinking tokens count toward max_tokens, so leave headroom.
            max_tokens: maxTokens + 1200,
            system,
            messages: [{ role: 'user', content: prompt }],
            // Low effort keeps ranking fast. Set ANTHROPIC_EFFORT=default if a model rejects it.
            ...(effort ? { output_config: { effort } } : {}),
          },
          { timeout: timeoutMs, signal },
        );
        return message.content
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('')
          .trim();
      } catch (error) {
        // Surface the API status (e.g. 401 bad key, 404 unknown model) in the function log.
        if (error instanceof Anthropic.APIError) throw new Error(`Anthropic API ${error.status ?? ''}: ${error.message}`, { cause: error });
        throw error;
      }
    },
  };
}
