import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { parseCompanyUrl } from '@shared/domain';
import { DEMO_SCENARIOS } from '@shared/mocks/fixtures';
import type { PipelineStep, SearchResponse } from '@shared/types';
import { EmptyState } from '@/components/EmptyState';
import { ResultList } from '@/components/ResultCard';
import { SearchSteps } from '@/components/SearchSteps';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { requireBackend } from '@/lib/backend';
import { DEMO_MODE } from '@/lib/config';
import { cn, errorMessage } from '@/lib/utils';

type Status =
  | { kind: 'idle' }
  | { kind: 'searching'; step: PipelineStep }
  | { kind: 'done'; response: SearchResponse }
  | { kind: 'error'; message: string; code: string };

const inlineInput =
  'min-w-0 border-0 border-b-2 border-line-strong bg-transparent px-1 pb-1 font-semibold text-ink placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:outline-none focus-visible:outline-none aria-[invalid=true]:border-danger';

/** The inline inputs grow with their text (in ch units), within limits, so the sentence stays readable. */
function growWidth(value: string, placeholder: string, maxCh: number): string {
  const length = Math.max(value.length, placeholder.length) + 1.5;
  return `${Math.min(Math.max(length, 5), maxCh)}ch`;
}

function rankedByLabel(response: SearchResponse): string {
  if (response.fromCache) return 'Saved result from the last 7 days';
  return response.rankedBy === 'claude' ? 'Ranked by Claude' : 'Ranked by fallback rules (Claude unavailable)';
}

export function SearchPage() {
  const [params] = useSearchParams();
  const [position, setPosition] = useState(params.get('position') ?? '');
  const [companyUrl, setCompanyUrl] = useState(params.get('company') ?? '');
  const [fieldError, setFieldError] = useState<{ field: 'position' | 'company'; message: string } | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async (nextPosition = position, nextCompany = companyUrl) => {
    setFieldError(null);
    const company = parseCompanyUrl(nextCompany);
    if (!company.ok) return setFieldError({ field: 'company', message: company.error });
    if (nextPosition.trim().length < 2)
      return setFieldError({ field: 'position', message: 'Enter a position, e.g. CTO or Head of Marketing.' });
    if (nextPosition.trim().length > 100)
      return setFieldError({ field: 'position', message: 'The position must be 100 characters or fewer.' });

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const backend = requireBackend();
    setStatus({ kind: 'searching', step: 'company' });

    // The real backend answers in one request, so its step labels follow typical timings;
    // the demo reports each pipeline step as it actually happens.
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (backend.mode !== 'demo') {
      timers.push(setTimeout(() => setStatus((s) => (s.kind === 'searching' ? { kind: 'searching', step: 'search' } : s)), 1200));
      timers.push(setTimeout(() => setStatus((s) => (s.kind === 'searching' ? { kind: 'searching', step: 'rank' } : s)), 3500));
    }

    try {
      const response = await backend.search(
        { companyUrl: nextCompany.trim(), position: nextPosition.trim() },
        { signal: controller.signal, onStep: (step) => setStatus((s) => (s.kind === 'searching' ? { kind: 'searching', step } : s)) },
      );
      if (controller.signal.aborted) return;
      setStatus({ kind: 'done', response });
      if (response.message && response.results.length > 0) toast.warning(response.message);
      requestAnimationFrame(() => resultsRef.current?.focus({ preventScroll: false }));
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = errorMessage(error);
      // Shown inline below the form; no toast, so the message isn't repeated.
      setStatus({ kind: 'error', message, code: error instanceof ApiError ? error.code : 'unknown' });
    } finally {
      timers.forEach(clearTimeout);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run();
  };

  const searching = status.kind === 'searching';

  return (
    <div className="flex flex-col gap-10">
      <form onSubmit={submit} noValidate aria-labelledby="search-heading">
        <h1 id="search-heading" className="sr-only">
          Find LinkedIn profiles
        </h1>
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-4 text-[1.75rem] leading-tight tracking-tight sm:text-[2.25rem] lg:text-[2.75rem]">
          <span className="text-muted">Who is the</span>
          <label className="sr-only" htmlFor="position">
            Position
          </label>
          <input
            id="position"
            className={cn(inlineInput, 'w-full sm:w-[var(--w)]')}
            style={{ '--w': growWidth(position, 'CTO', 18) } as CSSProperties}
            placeholder="CTO"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            maxLength={100}
            autoComplete="organization-title"
            aria-invalid={fieldError?.field === 'position' || undefined}
            aria-describedby="search-help"
          />
          <span className="text-muted">at</span>
          <span className="flex w-full items-baseline gap-2 sm:w-auto">
            <label className="sr-only" htmlFor="company">
              Company website
            </label>
            <input
              id="company"
              className={cn(inlineInput, 'w-full sm:w-[var(--w)]')}
              style={{ '--w': growWidth(companyUrl, 'stripe.com', 22) } as CSSProperties}
              placeholder="stripe.com"
              value={companyUrl}
              onChange={(e) => setCompanyUrl(e.target.value)}
              maxLength={500}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={fieldError?.field === 'company' || undefined}
              aria-describedby="search-help"
            />
            <span className="hidden text-muted sm:inline">?</span>
          </span>
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Button type="submit" size="lg" loading={searching}>
            {searching ? 'Searching' : 'Find profiles'}
          </Button>
          <p id="search-help" className={cn('text-sm', fieldError ? 'text-danger' : 'text-muted')} role={fieldError ? 'alert' : undefined}>
            {fieldError?.message ?? 'Any company address works: https://, www. and page paths are fine.'}
          </p>
        </div>

        {DEMO_MODE && status.kind === 'idle' && (
          <div className="mt-8 border-t border-line pt-5">
            <h2 className="text-[15px] font-semibold">Try a demo scenario</h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {DEMO_SCENARIOS.map((scenario) => (
                <li key={scenario.domain}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start rounded-md border border-line bg-surface px-3 py-2.5 text-left hover:border-accent"
                    onClick={() => {
                      setPosition(scenario.position);
                      setCompanyUrl(scenario.domain);
                      void run(scenario.position, scenario.domain);
                    }}
                  >
                    <span className="text-[15px] font-medium">
                      {scenario.position} at {scenario.domain}
                    </span>
                    <span className="text-sm text-muted">{scenario.note}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>

      {status.kind === 'searching' && <SearchSteps current={status.step} />}

      {status.kind === 'error' && (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft px-5 py-4" role="alert">
          <p className="flex items-start gap-2 text-[15px] text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {status.message}
          </p>
          {status.code !== 'rate_limited' && status.code !== 'invalid_input' && (
            <Button variant="secondary" size="sm" onClick={() => void run()}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Try again
            </Button>
          )}
        </div>
      )}

      {status.kind === 'done' && (
        <section ref={resultsRef} tabIndex={-1} aria-labelledby="results-heading" className="flex flex-col gap-6 focus:outline-none">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div>
              <p className="text-sm text-muted">Company found</p>
              <h2 id="results-heading" className="text-2xl font-semibold tracking-tight">
                {status.response.companyName} <span className="text-lg font-normal text-muted">{status.response.domain}</span>
              </h2>
            </div>
            <p className="text-sm text-muted">{rankedByLabel(status.response)}</p>
          </div>

          {status.response.results.length > 0 ? (
            <>
              <ResultList results={status.response.results} animate />
              <p className="text-sm text-muted">
                Not the company you meant? The name comes from the website itself, so double-check the address. Confidence is an estimate
                based on public search results.
              </p>
            </>
          ) : (
            <EmptyState title="No matching profiles found">
              <p>
                Try a broader title (for example “Marketing” instead of “Senior Brand Marketing Lead”), or check that the website belongs to
                the company you mean.
              </p>
            </EmptyState>
          )}
        </section>
      )}
    </div>
  );
}
