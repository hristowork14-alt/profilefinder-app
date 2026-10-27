import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/auth/context';
import { AuthShell } from '@/components/AuthShell';
import { useHumanCheck } from '@/components/HumanCheck';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { requireBackend } from '@/lib/backend';
import { DEMO_MODE, MIN_PASSWORD_LENGTH } from '@/lib/config';
import { breachedPasswordError } from '@/lib/pwnedPassword';
import { errorMessage } from '@/lib/utils';

// Captured at startup, before Supabase reads and clears the reset link's #type=recovery.
const ARRIVED_FROM_RESET_LINK = typeof window !== 'undefined' && /type=recovery/.test(window.location.hash);

export function ResetPasswordPage() {
  const { user, recovering, clearRecovery } = useAuth();
  const showUpdateForm = recovering || (ARRIVED_FROM_RESET_LINK && Boolean(user));
  return showUpdateForm ? <ChooseNewPassword onDone={clearRecovery} /> : <RequestReset />;
}

function RequestReset() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const human = useHumanCheck();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email address.');
    setBusy(true);
    try {
      await requireBackend().auth.requestPasswordReset(email.trim(), human.token);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      human.reset(); // a token works once
      setBusy(false);
    }
  };

  const openDemoLink = async () => {
    try {
      await requireBackend().auth.openDemoRecoveryLink?.(email.trim());
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        description={
          DEMO_MODE ? (
            'In the real app, a reset link is emailed to you. In demo mode nothing is sent, so use the button below to follow that link.'
          ) : (
            <>
              If an account exists for <strong className="text-ink">{email.trim()}</strong>, a reset link is on its way. Open it on this
              device to choose a new password.
            </>
          )
        }
        footer={
          <Link to="/login" className="font-medium text-accent underline-offset-4 hover:underline">
            Back to log in
          </Link>
        }
      >
        {DEMO_MODE && <Button onClick={openDemoLink}>Open the reset link</Button>}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      description="Enter the email you signed up with and we'll send you a link to choose a new password."
      footer={
        <Link to="/login" className="font-medium text-accent underline-offset-4 hover:underline">
          Back to log in
        </Link>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={error}
        />
        {human.widget}
        <Button type="submit" size="lg" loading={busy} disabled={!email || !human.ready}>
          Send reset link
        </Button>
      </form>
    </AuthShell>
  );
}

function ChooseNewPassword({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      const breached = DEMO_MODE ? null : await breachedPasswordError(password);
      if (breached) return setError(breached);
      await requireBackend().auth.updatePassword(password);
      onDone();
      toast.success('Password updated');
      navigate('/app', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Choose a new password" description="You followed a reset link. Pick a new password for your account.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        />
        <Field
          label="Repeat new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={error}
        />
        <Button type="submit" size="lg" loading={busy} disabled={!password || !confirm}>
          Update password
        </Button>
      </form>
    </AuthShell>
  );
}
