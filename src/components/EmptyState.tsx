import type { ReactNode } from 'react';

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line-strong px-5 py-8">
      <h3 className="text-lg font-semibold">{title}</h3>
      {children && <div className="max-w-[60ch] text-[15px] text-muted">{children}</div>}
      {action}
    </div>
  );
}

export function PageLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-muted" role="status">
      <span className="size-5 animate-spin rounded-full border-2 border-line-strong border-r-transparent" aria-hidden="true" />
      {label}
    </div>
  );
}
