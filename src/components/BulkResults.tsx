// The Bulk results table: a count per status, a "Needs review" filter, and one row per company
// with the same plain-language status the Excel file uses.

import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { ExportRow } from '@/lib/csv';
import { STATUS_ORDER, rowStatus, statusCounts, statusInfo, type StatusKey } from '@/lib/resultStatus';
import { cn } from '@/lib/utils';

const TONE: Record<StatusKey, string> = {
  verified: 'bg-high-soft text-high',
  verified_elsewhere: 'bg-high-soft text-high',
  verified_name_match: 'bg-accent-soft text-accent',
  likely: 'bg-mid-soft text-mid',
  closest: 'bg-low-soft text-low',
  verified_no_profile: 'bg-accent-soft text-accent',
  match: 'bg-accent-soft text-accent',
  possible: 'bg-mid-soft text-mid',
  many: 'bg-mid-soft text-mid',
  conflict: 'bg-danger-soft text-danger',
  not_found: 'bg-low-soft text-low',
  failed: 'bg-danger-soft text-danger',
  pending: 'bg-low-soft text-low',
};

export interface BulkResultItem {
  id: string;
  result: ExportRow;
  /** False while a finished row's result is still loading. */
  loaded: boolean;
}

function Badge({ className, children, title }: { className: string; children: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold whitespace-nowrap', className)}>
      {children}
    </span>
  );
}

function StatusCell({ item }: { item: BulkResultItem }) {
  if (item.result.status === 'running') return <Badge className="bg-accent-soft text-accent">Searching…</Badge>;
  if (!item.loaded) return <Badge className="bg-low-soft text-low">Loading…</Badge>;
  const info = statusInfo(rowStatus(item.result));
  return (
    <Badge className={TONE[info.key]} title={info.meaning}>
      {info.label}
    </Badge>
  );
}

export function BulkResults({ items }: { items: BulkResultItem[] }) {
  const [filter, setFilter] = useState<'all' | 'review'>('all');
  const finished = items.filter((i) => i.loaded && i.result.status !== 'running');
  const counts = statusCounts(finished.map((i) => i.result));
  const needsReview = items.filter((i) => i.loaded && statusInfo(rowStatus(i.result)).group !== 'found' && i.result.status !== 'running');
  const shown = filter === 'review' ? needsReview : items;
  const present = new Set(counts.map((c) => c.key));

  return (
    <div className="flex flex-col gap-4">
      {counts.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Rows per status">
          {counts.map((c) => (
            <li key={c.key}>
              <Badge className={TONE[c.key]} title={statusInfo(c.key).meaning}>
                {`${c.label}: ${c.count}`}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter rows">
        {(
          [
            ['all', `All rows (${items.length})`],
            ['review', `Needs review (${needsReview.length})`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm font-medium transition-colors',
              filter === value
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line-strong text-muted hover:border-ink hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[56rem] border-collapse text-left text-[15px]">
          <thead className="bg-surface text-sm text-muted shadow-[0_1px_0_var(--line)]">
            <tr>
              <th scope="col" className="w-12 px-3 py-2.5 font-medium">
                Row
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                Company
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                Position
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                Status
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                Person
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                LinkedIn
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                Source
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((item) => {
              const { result } = item;
              const top = result.results[0];
              const person = top?.fullName ?? result.verifiedHolder?.name;
              const source = result.verifiedHolder?.sourceLinks[0];
              return (
                <tr key={item.id} className="align-top">
                  <td className="tabular px-3 py-2.5 text-muted">{result.rowNumber}</td>
                  <td className="max-w-[12rem] px-3 py-2.5">
                    <span className="block truncate font-medium">{result.companyName ?? result.companyUrl}</span>
                    {result.companyName && <span className="block truncate text-sm text-muted">{result.companyUrl}</span>}
                  </td>
                  <td className="max-w-[11rem] px-3 py-2.5 break-words">{result.position}</td>
                  <td className="px-3 py-2.5">
                    <StatusCell item={item} />
                    {result.status === 'failed' && result.error && <span className="mt-1 block text-sm text-danger">{result.error}</span>}
                  </td>
                  <td className="max-w-[14rem] px-3 py-2.5">
                    {person ? <span className="block font-medium break-words">{person}</span> : <span className="text-muted">—</span>}
                    {top?.headline && <span className="block text-sm break-words text-muted">{top.headline}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {top ? (
                      <a
                        href={top.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-accent underline-offset-4 hover:underline"
                      >
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                        Profile
                      </a>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="max-w-[16rem] px-3 py-2.5">
                    {source ? (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={source.quote}
                        className="block truncate text-accent underline-offset-4 hover:underline"
                      >
                        {source.title || source.url}
                      </a>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted">
                  Nothing to review.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <details className="text-[15px]">
        <summary className="cursor-pointer font-medium text-accent">What do the statuses mean?</summary>
        <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr]">
          {STATUS_ORDER.filter((key) => present.has(key) || key === 'conflict' || key === 'possible').map((key) => {
            const info = statusInfo(key);
            return (
              <div key={key} className="contents">
                <dt>
                  <Badge className={TONE[key]}>{info.label}</Badge>
                </dt>
                <dd className="text-muted">
                  {info.meaning} {info.action}
                </dd>
              </div>
            );
          })}
        </dl>
        <p className="mt-3 text-sm text-muted">
          LinkedIn links come from Google search results; ProfileFinder never opens LinkedIn, so a profile can be out of date.
        </p>
      </details>
    </div>
  );
}
