// POST /.netlify/functions/delete-account
// Deletes the signed-in user from Supabase Auth. Every table references auth.users with
// ON DELETE CASCADE, so all of their data (profile, searches, results, bulk jobs) goes too.
// This needs the secret key, which is why it can't be done from the browser.

import type { Context } from '@netlify/functions';
import { createAuthenticator } from './_lib/auth';
import { ConfigError, readEnv } from './_lib/env';
import { errorResponse, json } from './_lib/http';
import { log } from './_lib/runtime';
import { getSupabaseAdmin } from './_lib/supabaseAdmin';

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Use POST for this endpoint.', { Allow: 'POST' });

  try {
    const admin = getSupabaseAdmin(readEnv());
    const user = await createAuthenticator(admin)(req).catch(() => null);
    if (!user) return errorResponse(401, 'unauthorized', 'Your session has expired. Please log in again.');

    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) {
      log(`Account deletion failed: ${error.message}`);
      return errorResponse(500, 'server_error', 'Your account could not be deleted. Please try again.');
    }
    return json(200, { ok: true });
  } catch (error) {
    if (error instanceof ConfigError) {
      log(`Configuration error: ${error.message}`);
      return errorResponse(503, 'not_configured', 'Account deletion is not configured yet. Check the environment variables (see README).');
    }
    log(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    return errorResponse(500, 'server_error', 'Something went wrong on our side. Please try again in a minute.');
  }
};
