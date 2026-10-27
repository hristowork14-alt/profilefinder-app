import { describe, expect, it } from 'vitest';
import { checkPwnedPassword, sha1Hex } from '../src/lib/pwnedPassword';

// SHA-1("password123") = CBFDA C6008F9CAB4083784CBD1874F76618D2A97 (a well-known breached password).
const PREFIX = 'CBFDA';
const SUFFIX = 'C6008F9CAB4083784CBD1874F76618D2A97';

interface Seen {
  url: string;
  headers: Record<string, string>;
}

/** A fake fetch that records what was sent and answers with the given body and status. */
function fakeFetch(body: string, status = 200, seen: Seen[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return new Response(body, { status });
  }) as typeof fetch;
}

describe('sha1Hex', () => {
  it('returns the uppercase SHA-1 hex of the text', async () => {
    expect(await sha1Hex('password123')).toBe(PREFIX + SUFFIX);
  });
});

describe('checkPwnedPassword', () => {
  it('sends only the 5-character hash prefix, with response padding on', async () => {
    const seen: Seen[] = [];
    await checkPwnedPassword('password123', { fetchImpl: fakeFetch('', 200, seen) });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`);
    expect(seen[0]!.headers['add-padding']).toBe('true');
    const sent = JSON.stringify(seen);
    expect(sent).not.toContain('password123');
    expect(sent).not.toContain(SUFFIX);
  });

  it('reports a password that appears in a breach, with how often', async () => {
    const body = ['0018A45C4D1DEF81644B54AB7F969B88D65:1', `${SUFFIX}:2500000`, '00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2'].join('\r\n');
    expect(await checkPwnedPassword('password123', { fetchImpl: fakeFetch(body) })).toEqual({ status: 'pwned', count: 2500000 });
  });

  it('says ok when the suffix is not in the list', async () => {
    const body = ['0018A45C4D1DEF81644B54AB7F969B88D65:1', '00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2'].join('\r\n');
    expect(await checkPwnedPassword('password123', { fetchImpl: fakeFetch(body) })).toEqual({ status: 'ok' });
  });

  it('ignores padding lines (count 0)', async () => {
    const body = [`${SUFFIX}:0`, '0018A45C4D1DEF81644B54AB7F969B88D65:0'].join('\r\n');
    expect(await checkPwnedPassword('password123', { fetchImpl: fakeFetch(body) })).toEqual({ status: 'ok' });
  });

  it('fails open on a non-200 answer', async () => {
    expect(await checkPwnedPassword('password123', { fetchImpl: fakeFetch('busy', 503) })).toEqual({ status: 'unknown' });
  });

  it('fails open on a network error', async () => {
    const broken = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await checkPwnedPassword('password123', { fetchImpl: broken })).toEqual({ status: 'unknown' });
  });

  it('fails open when the service does not answer in time', async () => {
    const hanging = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as typeof fetch;
    const started = Date.now();
    expect(await checkPwnedPassword('password123', { fetchImpl: hanging, timeoutMs: 30 })).toEqual({ status: 'unknown' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('fails open when the caller cancels', async () => {
    const controller = new AbortController();
    controller.abort();
    const hanging = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) reject(new DOMException('aborted', 'AbortError'));
      })) as typeof fetch;
    expect(await checkPwnedPassword('password123', { fetchImpl: hanging, signal: controller.signal })).toEqual({ status: 'unknown' });
  });
});
