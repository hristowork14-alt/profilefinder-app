import { LogOut } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/auth/context';
import { PageHeader } from '@/components/Layout';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Field } from '@/components/ui/Field';
import { requireBackend } from '@/lib/backend';
import { DEMO_MODE, MIN_PASSWORD_LENGTH } from '@/lib/config';
import { breachedPasswordError } from '@/lib/pwnedPassword';
import { errorMessage } from '@/lib/utils';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line py-8 md:grid-cols-[14rem_1fr] md:gap-10">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="max-w-md">{children}</div>
    </section>
  );
}

export function AccountPage() {
  const { user, setExitTo } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    if (password.length < MIN_PASSWORD_LENGTH) return setPasswordError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (password !== confirm) return setPasswordError('The two passwords do not match.');
    setSavingPassword(true);
    try {
      const breached = DEMO_MODE ? null : await breachedPasswordError(password);
      if (breached) return setPasswordError(breached);
      await requireBackend().auth.updatePassword(password);
      setPassword('');
      setConfirm('');
      toast.success('Password changed');
    } catch (error) {
      setPasswordError(errorMessage(error));
    } finally {
      setSavingPassword(false);
    }
  };

  const logOut = async () => {
    setExitTo({ from: location.pathname, to: '/' });
    try {
      await requireBackend().auth.signOut();
      navigate('/', { replace: true });
    } catch (error) {
      setExitTo(null);
      toast.error(errorMessage(error));
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    setExitTo({ from: location.pathname, to: '/' });
    try {
      await requireBackend().auth.deleteAccount();
      toast.success('Your account and all its data were deleted');
      navigate('/', { replace: true });
    } catch (error) {
      setExitTo(null);
      toast.error(errorMessage(error));
      setDeleting(false);
    }
  };

  return (
    <>
      <PageHeader title="Account" />

      <Section title="Email">
        <p className="text-[15px] break-all">{user?.email}</p>
      </Section>

      <Section title="Change password">
        <form onSubmit={changePassword} className="flex flex-col gap-4" noValidate>
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
            error={passwordError}
          />
          <Button type="submit" className="self-start" loading={savingPassword} disabled={!password || !confirm}>
            Change password
          </Button>
        </form>
      </Section>

      <Section title="Session">
        <Button variant="secondary" onClick={() => void logOut()}>
          <LogOut className="size-4" aria-hidden="true" />
          Log out
        </Button>
      </Section>

      <Section title="Delete account">
        <p className="mb-4 text-[15px] text-muted">
          Permanently deletes your account, your search history, saved results and bulk jobs. This cannot be undone.
        </p>
        <Button variant="danger" onClick={() => setDeleteOpen(true)}>
          Delete my account
        </Button>
      </Section>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete your account?"
        description="Your account and every search, result and bulk job linked to it will be permanently deleted."
        confirmLabel="Delete account"
        requireText="DELETE"
        busy={deleting}
        onConfirm={() => void deleteAccount()}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  );
}
