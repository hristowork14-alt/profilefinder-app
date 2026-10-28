// Cloudflare Turnstile "are you human?" check for the sign-up, log-in and reset-request forms.
// Supabase Auth verifies the token server-side once CAPTCHA protection is switched on there.
//
// Usage: const human = useHumanCheck(); render {human.widget}, disable submit until human.ready,
// pass human.token to the auth call, and call human.reset() after every attempt — a token can be
// used only once. Without a site key (local dev, demo) it renders nothing and is always ready.

import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { HUMAN_CHECK_ENABLED, TURNSTILE_SITE_KEY } from '@/lib/config';
import { classifyTurnstileError, humanCheckFailureMessage, type HumanCheckFailure } from '@/lib/humanCheckError';

export const HUMAN_CHECK_FAILED_MESSAGE = humanCheckFailureMessage('load');

export interface HumanCheck {
  /** The token to send with the auth call (undefined when the check is off or not done yet). */
  token: string | undefined;
  /** True when the form may be submitted. */
  ready: boolean;
  /** Clears the used token and asks Turnstile for a fresh one. */
  reset: () => void;
  widget: ReactNode;
}

export function useHumanCheck(): HumanCheck {
  const instance = useRef<TurnstileInstance | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [failure, setFailure] = useState<HumanCheckFailure | null>(null);
  // True while Cloudflare shows its checkbox and waits for the person to tick it.
  const [needsClick, setNeedsClick] = useState(false);

  const reset = useCallback(() => {
    setToken(null);
    setFailure(null);
    setNeedsClick(false);
    if (HUMAN_CHECK_ENABLED) instance.current?.reset();
  }, []);

  const widget = useMemo(() => {
    if (!HUMAN_CHECK_ENABLED) return null;
    return (
      <div className="flex flex-col gap-1.5">
        <Turnstile
          ref={instance}
          siteKey={TURNSTILE_SITE_KEY}
          // Shown only if Cloudflare needs the person to click; otherwise it works invisibly.
          options={{ theme: 'auto', size: 'flexible', appearance: 'interaction-only', language: 'auto' }}
          onSuccess={(value) => {
            setToken(value);
            setFailure(null);
          }}
          onBeforeInteractive={() => setNeedsClick(true)}
          onAfterInteractive={() => setNeedsClick(false)}
          onExpire={() => setToken(null)}
          onTimeout={() => setToken(null)}
          onError={(code) => {
            setToken(null);
            setFailure(classifyTurnstileError(code));
          }}
          onUnsupported={() => setFailure('unsupported')}
          scriptOptions={{ onError: () => setFailure('load') }}
        />
        {failure ? (
          <div className="flex flex-col items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            <p>{humanCheckFailureMessage(failure)}</p>
            {failure === 'challenge' && (
              <Button variant="secondary" size="sm" onClick={reset}>
                Try again
              </Button>
            )}
          </div>
        ) : (
          token === null && (
            <p className="text-sm text-muted" aria-live="polite">
              {needsClick ? 'Tick the box above to confirm you are human.' : "Checking you're human…"}
            </p>
          )
        )}
      </div>
    );
  }, [failure, needsClick, token, reset]);

  return { token: token ?? undefined, ready: !HUMAN_CHECK_ENABLED || token !== null, reset, widget };
}
