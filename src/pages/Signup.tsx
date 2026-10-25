import { MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/auth/context';
import { AuthShell, GoogleIcon } from '@/components/AuthShell';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { requireBackend } from '@/lib/backend';
import { DEMO_MODE, MIN_PASSWORD_LENGTH, SHOW_GOOGLE_SIGN_IN } from '@/lib/config';
import { errorMessage } from '@/lib/utils';

export function SignupPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (user && !sentTo) return <Navigate to="/app" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email address.');
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
    setBusy(true);
    try {
      const { needsConfirmation } = await requireBackend().auth.signUp(email.trim(), password);
      if (needsConfirmation) setSentTo(email.trim());
      else {
        toast.success('Account created');
        navigate('/app', { replace: true });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <AuthShell
        title="Check your email"
        description={
          <>
            We sent a confirmation link to <strong className="text-ink">{sentTo}</strong>. Open it to activate your account, then log in.
          </>
        }
      >
        <div className="flex items-center gap-3 rounded-md bg-accent-soft px-4 py-3 text-[15px]">
          <MailCheck className="size-5 shrink-0 text-accent" aria-hidden="true" />
          Didn't get it? Check spam, or try again in a minute.
        </div>
        <Link to="/login" className="mt-6 inline-block font-medium text-accent underline-offset-4 hover:underline">
          Go to log in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      description={
        DEMO_MODE
          ? 'Demo mode: any email works and nothing is sent. The account lives only in this browser.'
          : 'Free to use. You can delete your account and data at any time.'
      }
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-accent underline-offset-4 hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        />
        {error && (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" loading={busy} disabled={!email || !password}>
          Create account
        </Button>
        {SHOW_GOOGLE_SIGN_IN && (
          <Button
            variant="secondary"
            size="lg"
            onClick={() =>
              requireBackend()
                .auth.signInWithGoogle()
                .catch((err: unknown) => toast.error(errorMessage(err)))
            }
          >
            <GoogleIcon />
            Continue with Google
          </Button>
        )}
      </form>
    </AuthShell>
  );
}
