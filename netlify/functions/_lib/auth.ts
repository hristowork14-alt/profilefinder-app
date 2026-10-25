// Verifies the Supabase access token sent by the browser in `Authorization: Bearer <token>`.

import { withTimeout } from '../../../shared/deadline';
import type { AuthenticatedUser } from './handler';
import { bearerToken } from './http';
import type { AdminClient } from './supabaseAdmin';

export function createAuthenticator(admin: AdminClient, timeoutMs = 3000) {
  return async (req: Request): Promise<AuthenticatedUser | null> => {
    const token = bearerToken(req);
    if (!token) return null;
    // getUser() asks Supabase Auth to validate the token (signature, expiry, revoked sessions).
    const { data, error } = await withTimeout('auth', timeoutMs, () => admin.auth.getUser(token));
    if (error || !data.user) return null;
    return { id: data.user.id };
  };
}
