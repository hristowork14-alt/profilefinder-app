import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** If set, the user must type this word to enable the confirm button. */
  requireText?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Accessible confirmation built on the native <dialog> element (focus trap and Esc for free). */
export function ConfirmDialog({ open, title, description, confirmLabel, requireText, busy, onConfirm, onCancel }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setTyped('');
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const canConfirm = !requireText || typed.trim().toUpperCase() === requireText.toUpperCase();

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40"
      aria-labelledby="confirm-title"
    >
      <form
        method="dialog"
        className="flex flex-col gap-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (canConfirm && !busy) onConfirm();
        }}
      >
        <h2 id="confirm-title" className="text-lg font-semibold">
          {title}
        </h2>
        <div className="text-[15px] text-muted">{description}</div>
        {requireText && (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Type {requireText} to confirm
            <input
              className="h-10 rounded-md border border-line-strong bg-surface px-3 text-[15px] focus:border-danger focus:outline-none"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoFocus
            />
          </label>
        )}
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            disabled={!canConfirm}
            loading={busy}
            className="bg-danger text-surface hover:bg-danger/90 disabled:opacity-40"
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
