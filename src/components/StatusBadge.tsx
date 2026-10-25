import { cn } from '@/lib/utils';

type Status = 'completed' | 'no_results' | 'failed' | 'pending' | 'running';

const styles: Record<Status, { label: string; className: string }> = {
  completed: { label: 'Found', className: 'bg-high-soft text-high' },
  no_results: { label: 'No results', className: 'bg-low-soft text-low' },
  failed: { label: 'Failed', className: 'bg-danger-soft text-danger' },
  pending: { label: 'Waiting', className: 'bg-low-soft text-low' },
  running: { label: 'Running', className: 'bg-accent-soft text-accent' },
};

export function StatusBadge({ status, label, className }: { status: Status; label?: string; className?: string }) {
  const style = styles[status];
  return (
    <span
      className={cn('inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold whitespace-nowrap', style.className, className)}
    >
      {label ?? style.label}
    </span>
  );
}
