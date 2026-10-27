// Checks a new password against the public Pwned Passwords list (haveibeenpwned.com), so people
// don't pick a password that is already in attackers' lists.
//
// Privacy (k-anonymity): the password never leaves the browser. Only the first 5 characters of
// its SHA-1 hash are sent; the service answers with every hash suffix starting with them (padded
// with fake count-0 entries), and the comparison happens here.
//
// Fails open: if the service is slow or unreachable, the result is "unknown" and the form goes
// ahead as before — this check is an extra safety net, never a reason to block sign-up.

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const DEFAULT_TIMEOUT_MS = 3000;

export type PwnedResult = { status: 'pwned'; count: number } | { status: 'ok' } | { status: 'unknown' };

export interface PwnedOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export const PWNED_PASSWORD_MESSAGE = 'This password has appeared in a known data breach. Please choose a different one.';

/** Uppercase hex SHA-1 of the text (Web Crypto; available in browsers and Node). */
export async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export async function checkPwnedPassword(password: string, options: PwnedOptions = {}): Promise<PwnedResult> {
  const fetchImpl: typeof fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const response = await fetchImpl(`${RANGE_URL}${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      signal: controller.signal,
    });
    if (!response.ok) return { status: 'unknown' };
    const body = await response.text();
    for (const line of body.split(/\r?\n/)) {
      const [lineSuffix, rawCount] = line.trim().split(':');
      if (!lineSuffix || lineSuffix.toUpperCase() !== suffix) continue;
      const count = Number.parseInt(rawCount ?? '', 10);
      // Padding entries have a count of 0: they are not real breaches.
      return Number.isFinite(count) && count > 0 ? { status: 'pwned', count } : { status: 'ok' };
    }
    return { status: 'ok' };
  } catch {
    return { status: 'unknown' };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

/**
 * For password forms: the message to show if the password is known to be breached, else null.
 * "unknown" (service down or slow) never blocks.
 */
export async function breachedPasswordError(password: string, options?: PwnedOptions): Promise<string | null> {
  const result = await checkPwnedPassword(password, options);
  return result.status === 'pwned' ? PWNED_PASSWORD_MESSAGE : null;
}
