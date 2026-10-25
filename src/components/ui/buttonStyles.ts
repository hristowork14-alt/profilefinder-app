import { cn } from '@/lib/utils';

export type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover disabled:bg-line-strong disabled:text-surface',
  secondary: 'bg-surface text-ink border border-line-strong hover:border-ink disabled:text-muted disabled:border-line',
  ghost: 'text-ink hover:bg-sunken disabled:text-muted',
  danger: 'bg-surface text-danger border border-danger/40 hover:bg-danger-soft disabled:opacity-50',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-[15px] gap-2',
  lg: 'h-12 px-5 text-base gap-2',
};

export const buttonClasses = (variant: Variant = 'primary', size: Size = 'md', className?: string) =>
  cn(
    'inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed',
    variants[variant],
    sizes[size],
    className,
  );
