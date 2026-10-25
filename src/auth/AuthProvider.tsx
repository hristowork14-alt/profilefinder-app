import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getBackend } from '@/lib/backend';
import type { AuthUser } from '@/lib/backend/types';
import { AuthContext, type ExitTarget } from './context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  // Without a configured backend there is no session to check.
  const [loading, setLoading] = useState(() => getBackend() !== null);
  const [recovering, setRecovering] = useState(false);
  const [exitTo, setExitTo] = useState<ExitTarget | null>(null);

  useEffect(() => {
    const backend = getBackend();
    if (!backend) return;
    let active = true;
    backend.auth
      .getUser()
      .then((current) => {
        if (active) setUser(current);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const unsubscribe = backend.auth.onChange((next, event) => {
      setUser(next);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') setRecovering(false);
      if (event === 'SIGNED_IN') setExitTo(null);
      setLoading(false);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({ user, loading, recovering, clearRecovery: () => setRecovering(false), exitTo, setExitTo }),
    [user, loading, recovering, exitTo],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
