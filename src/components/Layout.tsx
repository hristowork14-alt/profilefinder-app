import { Menu, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/context';
import { cn } from '@/lib/utils';
import { buttonClasses } from './ui/buttonStyles';
import { DemoBanner } from './DemoBanner';
import { Logo } from './Logo';

const APP_LINKS = [
  { to: '/app', label: 'Search', end: true },
  { to: '/app/history', label: 'History', end: false },
  { to: '/app/bulk', label: 'Bulk', end: false },
  { to: '/app/account', label: 'Account', end: false },
];

function Footer() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted sm:px-6">
        <p>Results come from public web search. ProfileFinder never visits LinkedIn.</p>
        <Link to="/privacy" className="underline underline-offset-4 hover:text-ink">
          Privacy
        </Link>
      </div>
    </footer>
  );
}

/** Shell for signed-in pages. */
export function AppLayout() {
  const location = useLocation();
  // The mobile menu belongs to the page it was opened on, so navigating closes it.
  const [menuOpenOn, setMenuOpenOn] = useState<string | null>(null);
  const menuOpen = menuOpenOn === location.pathname;

  const links = (className: string) =>
    APP_LINKS.map((link) => (
      <NavLink
        key={link.to}
        to={link.to}
        end={link.end}
        className={({ isActive }) =>
          cn(
            className,
            'rounded-sm text-[15px] font-medium transition-colors',
            isActive ? 'text-ink underline decoration-accent decoration-2 underline-offset-[10px]' : 'text-muted hover:text-ink',
          )
        }
      >
        {link.label}
      </NavLink>
    ));

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <header className="border-b border-line bg-paper/90 backdrop-blur supports-[backdrop-filter]:bg-paper/75">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo to="/app" />
          <nav aria-label="Main" className="hidden items-center gap-7 sm:flex">
            {links('py-1')}
          </nav>
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-md hover:bg-sunken sm:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpenOn(menuOpen ? null : location.pathname)}
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {menuOpen && (
          <nav id="mobile-nav" aria-label="Main" className="flex flex-col gap-1 border-t border-line px-4 py-3 sm:hidden">
            {links('px-2 py-2.5')}
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

/** Shell for the landing, auth and privacy pages. */
export function PublicLayout({ children }: { children?: ReactNode }) {
  const { user } = useAuth();
  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-2">
          {user ? (
            <Link to="/app" className={buttonClasses('secondary', 'sm')}>
              Open the app
            </Link>
          ) : (
            <>
              <Link to="/login" className={buttonClasses('ghost', 'sm')}>
                Log in
              </Link>
              <Link to="/signup" className={buttonClasses('primary', 'sm')}>
                Sign up
              </Link>
            </>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">{children ?? <Outlet />}</main>
      <Footer />
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-[2.5rem] sm:leading-tight">{title}</h1>
        {description && <p className="mt-2 max-w-[62ch] text-[15px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
