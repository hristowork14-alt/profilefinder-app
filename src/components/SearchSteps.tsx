import { Check } from 'lucide-react';
import type { PipelineStep } from '@shared/types';
import { cn } from '@/lib/utils';

const STEPS: { key: PipelineStep; label: string }[] = [
  { key: 'company', label: 'Identifying company…' },
  { key: 'search', label: 'Searching…' },
  { key: 'rank', label: 'Ranking candidates…' },
];

/** The three pipeline stages, in order, with the current one highlighted. */
export function SearchSteps({ current }: { current: PipelineStep }) {
  const currentIndex = STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="flex flex-col gap-3 sm:flex-row sm:gap-8" aria-live="polite">
      {STEPS.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'todo';
        return (
          <li
            key={step.key}
            className={cn('flex items-center gap-2.5 text-[15px]', state === 'todo' ? 'text-muted/70' : 'text-ink')}
            aria-current={state === 'active' ? 'step' : undefined}
          >
            <span
              className={cn(
                'tabular flex size-6 items-center justify-center rounded-full border text-xs font-semibold',
                state === 'done' && 'border-accent bg-accent text-on-accent',
                state === 'active' && 'border-accent text-accent',
                state === 'todo' && 'border-line-strong',
              )}
              aria-hidden="true"
            >
              {state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
            </span>
            <span className={cn(state === 'active' && 'font-medium')}>{step.label}</span>
            {state === 'active' && (
              <span className="size-3.5 animate-spin rounded-full border-2 border-accent border-r-transparent" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
