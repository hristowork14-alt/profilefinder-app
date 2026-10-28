// POST /.netlify/functions/search
// Body: { companyUrl: string, position: string, bulkJobId?: string }
// Header: Authorization: Bearer <Supabase access token>

import type { Context } from '@netlify/functions';
import { createAuthenticator } from './_lib/auth';
import { CACHE_TTL_MS, CACHE_VALID_AFTER, ConfigError, readEnv } from './_lib/env';
import { createSearchHandler } from './_lib/handler';
import { errorResponse } from './_lib/http';
import { createPipelineDeps, log } from './_lib/runtime';
import { createSupabaseStore } from './_lib/store';
import { getSupabaseAdmin } from './_lib/supabaseAdmin';

export default async (req: Request, _context: Context): Promise<Response> => {
  try {
    const env = readEnv();
    const admin = getSupabaseAdmin(env);
    // Fail fast with a clear message if the search provider isn't configured.
    createPipelineDeps(env);

    const handler = createSearchHandler({
      authenticate: createAuthenticator(admin),
      store: createSupabaseStore(admin),
      pipelineDeps: () => createPipelineDeps(env),
      config: {
        maxSearchesPerHour: env.maxSearchesPerHour,
        maxSearchesPerDay: env.maxSearchesPerDay,
        cacheTtlMs: CACHE_TTL_MS,
        cacheValidAfter: CACHE_VALID_AFTER,
      },
      log,
    });
    return await handler(req);
  } catch (error) {
    if (error instanceof ConfigError) {
      log(`Configuration error: ${error.message}`);
      return errorResponse(503, 'not_configured', 'Search is not configured yet. Check the environment variables (see README).');
    }
    log(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    return errorResponse(500, 'server_error', 'Something went wrong on our side. Please try again in a minute.');
  }
};
