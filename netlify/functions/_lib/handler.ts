// HTTP layer of the `search` function: method check → auth → body → search service.
// Built as a factory so tests can inject fakes; search.ts wires the real dependencies.

import type { PipelineDeps } from '../../../shared/pipeline';
import type { SearchStore } from '../../../shared/records';
import { performSearch, type SearchServiceConfig } from '../../../shared/searchService';
import { BodyError, errorResponse, json, readJsonBody } from './http';

export interface AuthenticatedUser {
  id: string;
}

export interface SearchHandlerDeps {
  authenticate: (req: Request) => Promise<AuthenticatedUser | null>;
  store: SearchStore;
  /** A function so each request gets fresh provider instances. */
  pipelineDeps: () => PipelineDeps;
  config: SearchServiceConfig;
  log?: (message: string) => void;
}

export function createSearchHandler(deps: SearchHandlerDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? (() => {});

  return async (req) => {
    if (req.method !== 'POST') {
      return errorResponse(405, 'method_not_allowed', 'Use POST for this endpoint.', { Allow: 'POST' });
    }

    let user: AuthenticatedUser | null = null;
    try {
      user = await deps.authenticate(req);
    } catch (error) {
      log(`Auth check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!user) return errorResponse(401, 'unauthorized', 'Your session has expired. Please log in again.');

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return errorResponse(400, 'invalid_input', error instanceof BodyError ? error.message : 'Invalid request.');
    }

    try {
      const outcome = await performSearch(user.id, body, {
        store: deps.store,
        pipelineDeps: deps.pipelineDeps(),
        config: deps.config,
        log,
      });
      return json(outcome.status, outcome.body);
    } catch (error) {
      log(`Unexpected search error: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      return errorResponse(500, 'server_error', 'Something went wrong on our side. Please try again in a minute.');
    }
  };
}
