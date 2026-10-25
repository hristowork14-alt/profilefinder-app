import { Link } from 'react-router-dom';
import { buttonClasses } from '@/components/ui/buttonStyles';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-start gap-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-[15px] text-muted">The address may be mistyped, or the page was moved.</p>
      <Link to="/" className={buttonClasses('primary', 'md')}>
        Go to the home page
      </Link>
    </div>
  );
}

/** Shown when the real app is deployed without its Supabase environment variables. */
export function NotConfiguredPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Almost there</h1>
      <p className="text-[15px] text-muted">
        The app can't find its Supabase settings. Add <code className="rounded bg-sunken px-1">VITE_SUPABASE_URL</code> and{' '}
        <code className="rounded bg-sunken px-1">VITE_SUPABASE_PUBLISHABLE_KEY</code> to your{' '}
        <code className="rounded bg-sunken px-1">.env</code> file (local) or to Netlify → Site configuration → Environment variables, then
        rebuild. The README walks through it step by step.
      </p>
      <p className="text-[15px] text-muted">
        Just want to look around? Run <code className="rounded bg-sunken px-1">npm run dev:demo</code> for the demo with fictional data.
      </p>
    </div>
  );
}
