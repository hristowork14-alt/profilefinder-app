import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real Supabase client is replaced with a recorder, so these tests check exactly what the
// app sends to Supabase Auth — with and without a CAPTCHA token.
const calls: { method: string; args: unknown[] }[] = [];
let nextError: { message: string } | null = null;

const record =
  (method: string, data: unknown = {}) =>
  async (...args: unknown[]) => {
    calls.push({ method, args });
    return { data, error: nextError };
  };

vi.mock('../src/lib/supabaseClient', () => ({
  getSupabase: () => ({
    auth: {
      signUp: record('signUp', { session: null }),
      signInWithPassword: record('signInWithPassword'),
      resetPasswordForEmail: record('resetPasswordForEmail'),
      getSession: async () => ({ data: { session: null } }),
    },
  }),
}));

const { createSupabaseBackend, CAPTCHA_FAILED_MESSAGE } = await import('../src/lib/backend/supabaseBackend');

beforeEach(() => {
  calls.length = 0;
  nextError = null;
  vi.stubGlobal('window', { location: { origin: 'https://app.example' } });
});
afterEach(() => vi.unstubAllGlobals());

describe('auth calls carry the CAPTCHA token', () => {
  it('sign-up', async () => {
    await createSupabaseBackend().auth.signUp('a@example.com', 'pw-123456', 'tok-1');
    expect(calls[0]).toEqual({
      method: 'signUp',
      args: [
        { email: 'a@example.com', password: 'pw-123456', options: { emailRedirectTo: 'https://app.example/app', captchaToken: 'tok-1' } },
      ],
    });
  });

  it('log-in', async () => {
    await createSupabaseBackend().auth.signIn('a@example.com', 'pw-123456', 'tok-2');
    expect(calls[0]).toEqual({
      method: 'signInWithPassword',
      args: [{ email: 'a@example.com', password: 'pw-123456', options: { captchaToken: 'tok-2' } }],
    });
  });

  it('password-reset request', async () => {
    await createSupabaseBackend().auth.requestPasswordReset('a@example.com', 'tok-3');
    expect(calls[0]).toEqual({
      method: 'resetPasswordForEmail',
      args: ['a@example.com', { redirectTo: 'https://app.example/reset-password', captchaToken: 'tok-3' }],
    });
  });
});

describe('without a token, exactly what was sent before', () => {
  it('sign-up', async () => {
    await createSupabaseBackend().auth.signUp('a@example.com', 'pw-123456');
    expect(calls[0]?.args).toEqual([
      { email: 'a@example.com', password: 'pw-123456', options: { emailRedirectTo: 'https://app.example/app' } },
    ]);
  });

  it('log-in', async () => {
    await createSupabaseBackend().auth.signIn('a@example.com', 'pw-123456');
    expect(calls[0]?.args).toEqual([{ email: 'a@example.com', password: 'pw-123456' }]);
  });

  it('password-reset request', async () => {
    await createSupabaseBackend().auth.requestPasswordReset('a@example.com');
    expect(calls[0]?.args).toEqual(['a@example.com', { redirectTo: 'https://app.example/reset-password' }]);
  });
});

describe('a failed CAPTCHA check reads as a friendly message', () => {
  it.each([
    ['sign-up', () => createSupabaseBackend().auth.signUp('a@example.com', 'pw-123456', 'old')],
    ['log-in', () => createSupabaseBackend().auth.signIn('a@example.com', 'pw-123456', 'old')],
    ['password-reset request', () => createSupabaseBackend().auth.requestPasswordReset('a@example.com', 'old')],
  ])('%s', async (_name, call) => {
    nextError = { message: 'captcha protection: request disallowed (timeout-or-duplicate)' };
    expect(CAPTCHA_FAILED_MESSAGE).toBe('The human check expired or failed. Please try again.');
    await expect(call()).rejects.toThrow(/^The human check expired or failed\. Please try again\.$/);
  });

  it('keeps the existing wrong-password message', async () => {
    nextError = { message: 'Invalid login credentials' };
    await expect(createSupabaseBackend().auth.signIn('a@example.com', 'nope-nope')).rejects.toThrow('Wrong email or password.');
  });
});
