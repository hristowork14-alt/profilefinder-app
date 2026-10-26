import { BadgeCheck, ExternalLink, Info } from 'lucide-react';
import type { VerifiedHolder } from '@shared/types';

/** Shown when independent sources name the holder but no public LinkedIn profile was found. */
export function VerifiedHolderCard({ holder, position, companyName }: { holder: VerifiedHolder; position: string; companyName: string }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface px-5 py-5">
      <div className="flex items-start gap-3">
        <BadgeCheck className="mt-0.5 size-5 shrink-0 text-high" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[15px] text-muted">
            Independent sources say the {position} at {companyName} is
          </p>
          <p className="text-2xl font-semibold tracking-tight break-words">{holder.name}</p>
          <p className="mt-1 text-[15px] text-muted">No public LinkedIn profile was found for this person.</p>
        </div>
      </div>
      {holder.sourceLinks.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          <p className="text-sm font-medium text-muted">
            Confirmed by {holder.sources} independent {holder.sources === 1 ? 'source' : 'sources'}, for example:
          </p>
          <ul className="flex flex-col gap-1">
            {holder.sourceLinks.map((link) => (
              <li key={link.url} className="min-w-0">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1.5 text-[15px] text-accent underline-offset-4 hover:underline"
                >
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{link.title || link.url}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Small badge on a profile that independent sources confirm. */
export function VerifiedBadge({ sources }: { sources?: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-high-soft px-2 py-0.5 text-xs font-semibold text-high">
      <BadgeCheck className="size-3.5" aria-hidden="true" />
      {sources ? `Verified by ${sources} independent sources` : 'Verified by independent sources'}
    </span>
  );
}

/** Note under results when no independent source could confirm who holds the role. */
export function UnverifiedNote() {
  return (
    <p className="flex items-start gap-2 rounded-md bg-mid-soft px-4 py-3 text-[15px] text-mid">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      Not independently verified: no company website, press release or news source confirmed who holds this role. Check the profile before
      relying on it.
    </p>
  );
}
