import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/context';
import { ConfidenceBadge } from '@/components/ConfidenceBadge';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { DEMO_MODE } from '@/lib/config';

const SAMPLE = [
  { name: 'Maria Ivanova', headline: 'Chief Financial Officer at Nimbus Labs', confidence: 92 },
  { name: 'Daniel Novak', headline: 'VP Finance at Nimbus Labs', confidence: 71 },
  { name: 'Iva Keller', headline: 'Former CFO, now at Orbitly', confidence: 24 },
];

const STEPS = [
  { title: 'Identify the company', body: 'We read the company name from its website, so “acme.io” becomes Acme.' },
  { title: 'Search public results', body: 'Several web searches look for public LinkedIn profiles with that title at that company.' },
  {
    title: 'Rank the candidates',
    body: 'Claude weighs each result, demotes former employees and look-alike companies, and explains its pick.',
  },
];

export function LandingPage() {
  const { user } = useAuth();
  return (
    <div className="flex flex-col gap-16 sm:gap-24">
      <section className="grid items-center gap-10 md:grid-cols-[1.1fr_1fr]">
        <div>
          <h1 className="text-[2.5rem] leading-[1.05] font-semibold tracking-tight sm:text-[3.5rem]">
            Find who holds the role, not just who works there.
          </h1>
          <p className="mt-5 max-w-[46ch] text-lg text-muted">
            Enter a company website and a job title. ProfileFinder returns the 3–5 most likely LinkedIn profiles, each with a confidence
            score and the reason behind it.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {user ? (
              <Link to="/app" className={buttonClasses('primary', 'lg')}>
                Open the app
              </Link>
            ) : (
              <>
                <Link to="/signup" className={buttonClasses('primary', 'lg')}>
                  {DEMO_MODE ? 'Try the demo' : 'Sign up'}
                </Link>
                <Link to="/login" className={buttonClasses('secondary', 'lg')}>
                  Log in
                </Link>
              </>
            )}
          </div>
        </div>

        <figure className="rounded-lg border border-line bg-surface p-5 sm:p-6" aria-label="Example result">
          <p className="text-xl leading-snug tracking-tight sm:text-2xl">
            <span className="text-muted">Who is the</span> <span className="border-b-2 border-accent font-semibold">CFO</span>{' '}
            <span className="text-muted">at</span>{' '}
            <span className="border-b-2 border-accent font-semibold whitespace-nowrap">nimbus-labs.example</span>
            <span className="text-muted">?</span>
          </p>
          <ol className="mt-5 divide-y divide-line border-t border-line">
            {SAMPLE.map((person, index) => (
              <li key={person.name} className="grid grid-cols-[1.75rem_1fr_auto] items-center gap-3 py-3">
                <span className="tabular text-2xl font-light text-muted">{index + 1}</span>
                <span className="min-w-0">
                  <span className="block font-semibold">{person.name}</span>
                  <span className="block truncate text-sm text-muted">{person.headline}</span>
                </span>
                <ConfidenceBadge confidence={person.confidence} />
              </li>
            ))}
          </ol>
          <figcaption className="mt-3 text-sm text-muted">Illustration with fictional people.</figcaption>
        </figure>
      </section>

      <section aria-labelledby="how-heading">
        <h2 id="how-heading" className="text-2xl font-semibold tracking-tight">
          How a search works
        </h2>
        <ol className="mt-6 grid gap-6 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="border-t-2 border-ink pt-4">
              <span className="tabular text-sm font-semibold text-accent">Step {index + 1}</span>
              <h3 className="mt-1 text-lg font-semibold">{step.title}</h3>
              <p className="mt-1.5 text-[15px] text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-8 max-w-[70ch] text-[15px] text-muted">
          ProfileFinder only uses public web search results. It never logs in to or scrapes LinkedIn, and stores no emails or phone numbers.{' '}
          <Link to="/privacy" className="underline underline-offset-4 hover:text-ink">
            Read the privacy note
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
