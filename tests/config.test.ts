import { describe, expect, it } from 'vitest';
import { showGoogleSignIn } from '../src/lib/config';

describe('showGoogleSignIn', () => {
  it('always shows the button in demo mode (demo behaviour is unchanged)', () => {
    expect(showGoogleSignIn(true, undefined)).toBe(true);
    expect(showGoogleSignIn(true, 'false')).toBe(true);
  });

  it('hides the button in the real app unless Google sign-in is explicitly enabled', () => {
    expect(showGoogleSignIn(false, undefined)).toBe(false);
    expect(showGoogleSignIn(false, 'false')).toBe(false);
    expect(showGoogleSignIn(false, '')).toBe(false);
  });

  it('shows the button in the real app when VITE_GOOGLE_AUTH_ENABLED is "true"', () => {
    expect(showGoogleSignIn(false, 'true')).toBe(true);
    expect(showGoogleSignIn(false, ' true ')).toBe(true);
  });
});
