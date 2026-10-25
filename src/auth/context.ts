import { createContext, useContext } from 'react';
import type { AuthUser } from '@/lib/backend/types';

export interface ExitTarget {
  from: string;
  to: string;
}

export interface AuthState {
  user: AuthUser | null;
  /** True until the stored session has been checked. */
  loading: boolean;
  /** True after the user opened a password-reset link. */
  recovering: boolean;
  clearRecovery: () => void;
  /**
   * After a deliberate log-out or account deletion from page `from`, go to `to` instead of /login.
   * Tied to the page it was set on, so a later visit to another protected page still asks to log in.
   */
  exitTo: ExitTarget | null;
  setExitTo: (target: ExitTarget | null) => void;
}

export const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  recovering: false,
  clearRecovery: () => {},
  exitTo: null,
  setExitTo: () => {},
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
