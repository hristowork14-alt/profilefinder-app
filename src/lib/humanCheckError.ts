// Turns a Cloudflare Turnstile failure into a message a visitor can act on.
// Error code families: https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/

export type HumanCheckFailure =
  /** The Turnstile script itself could not be downloaded (offline, ad blocker, network filter). */
  | 'load'
  /** The check ran but this browser did not pass it; a retry or another browser usually helps. */
  | 'challenge'
  /** The site key or allowed domain is wrong — only the site owner can fix this. */
  | 'setup'
  /** Turnstile does not support this browser. */
  | 'unsupported';

export function classifyTurnstileError(code: string | undefined): Exclude<HumanCheckFailure, 'load'> {
  const value = (code ?? '').trim();
  if (/^1105\d\d$/.test(value)) return 'unsupported';
  if (/^110[12]\d\d$/.test(value) || value === '400020') return 'setup';
  return 'challenge';
}

const REGULAR_BROWSERS = 'Chrome, Edge, Firefox or Safari';

export function humanCheckFailureMessage(kind: HumanCheckFailure): string {
  switch (kind) {
    case 'load':
      return "The human check couldn't load. Refresh the page; if you use an ad blocker, allow challenges.cloudflare.com.";
    case 'challenge':
      return `The human check didn't pass in this browser. Click "Try again". If it keeps failing, open this page in ${REGULAR_BROWSERS}.`;
    case 'setup':
      return "The human check isn't set up correctly for this website yet. Please try again later.";
    case 'unsupported':
      return `This browser can't run the human check. Open this page in ${REGULAR_BROWSERS}.`;
  }
}
