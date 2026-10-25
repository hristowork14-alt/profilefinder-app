import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

export function Logo({ to = '/', className }: { to?: string; className?: string }) {
  return (
    <Link to={to} className={cn('inline-flex items-center gap-2 rounded-sm text-[17px] font-semibold tracking-tight text-ink', className)}>
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
        <rect width="24" height="24" rx="6" className="fill-accent" />
        <circle cx="11" cy="10" r="4.2" fill="none" className="stroke-on-accent" strokeWidth="2.2" />
        <path d="M14.2 13.2 18 17" className="stroke-on-accent" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      ProfileFinder
    </Link>
  );
}
