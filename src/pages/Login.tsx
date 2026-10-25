import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/auth/context';
import { AuthShell, GoogleIcon } from '@/components/AuthShell';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { requireBackend } from '@/lib/backend';
import { DEMO_MODE, SHOW_GOOGLE_SIGN_IN } from '@/lib/config';
import { errorMessage } from '@/lib/utils';

export function LoginPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/app';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={from} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requireBackend().auth.signIn(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    try {
      await requireBackend().auth.signInWithGoogle();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <AuthShell
      title="Log in"
      description={DEMO_MODE ? 'Demo accounts live only in this browser. New here? Sign up with any email.' : 'Welcome back.'}
      footer={
        <>
          No account yet?{' '}
          <Link to="/signup" className="font-medium text-accent underline-offset-4 hover:underline">
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={
            <Link to="/reset-password" className="underline-offset-4 hover:text-ink hover:underline">
              Forgot your password?
            </Link>
          }
        />
        {error && (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" loading={busy} disabled={!email || !password}>
          Log in
        </Button>
        {SHOW_GOOGLE_SIGN_IN && (
          <Button variant="secondary" size="lg" onClick={google}>
            <GoogleIcon />
            Continue with Google
          </Button>
        )}
      </form>
    </AuthShell>
  );
}
