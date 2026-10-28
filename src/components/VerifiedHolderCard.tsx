import { AlertTriangle, BadgeCheck, ExternalLink, Info, Users } from 'lucide-react';
import { isSingleHolderRole } from '@shared/roleKind';
import type { SearchResponse, SourceLink, VerifiedHolder } from '@shared/types';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The independent pages that name the person, each with the sentence that does so. */
export function SourceList({ links, sources }: { links: SourceLink[]; sources: number }) {
  if (links.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-3">
      <p className="text-sm font-medium text-muted">
        Confirmed by {plural(sources, 'independent website', 'independent websites')}, for example:
      </p>
      <ul className="flex flex-col gap-2">
        {links.map((link) => (
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
            {link.quote && <p className="mt-0.5 pl-5 text-sm break-words text-muted">“{link.quote}”</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

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
      <SourceList links={holder.sourceLinks} sources={holder.sources} />
    </div>
  );
}

/** Small badge on a profile that independent sources confirm. */
export function VerifiedBadge({ sources }: { sources?: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-high-soft px-2 py-0.5 text-xs font-semibold text-high">
      <BadgeCheck className="size-3.5" aria-hidden="true" />
      {sources ? `Verified by ${plural(sources, 'independent source', 'independent sources')}` : 'Verified by independent sources'}
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

/** Shown above unverified results when the sources and the LinkedIn profile disagree. */
export function ConflictNote() {
  return (
    <p className="flex items-start gap-2 rounded-md bg-danger-soft px-4 py-3 text-[15px] text-danger">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      Conflicting information: independent sources name someone for this role, but their LinkedIn profile disagrees (for example it shows
      another employer). They may have moved on, or it may be a different person — check before using.
    </p>
  );
}

/** Shown above results for a role many people hold at once (no single holder to verify). */
export function ManyHoldersNote() {
  return (
    <p className="flex items-start gap-2 rounded-md bg-mid-soft px-4 py-3 text-[15px] text-mid">
      <Users className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      Many people hold this role at the company, so there is no single person to verify. These are well-matching profiles — add seniority or
      a team (for example “Head of Engineering”) to find one specific person.
    </p>
  );
}

/** The right note above a result list, depending on how the answer was reached. */
export function VerificationNote({
  decision,
  verifiedHolder,
  position,
}: {
  decision?: SearchResponse['decision'];
  verifiedHolder?: VerifiedHolder | null;
  position: string;
}) {
  if (decision === 'contradicted') return <ConflictNote />;
  // verifiedHolder === null (or the stored outcome "unverified"): verification ran and nobody could be confirmed.
  if (verifiedHolder !== null && decision !== 'unverified') return null;
  return isSingleHolderRole(position) ? <UnverifiedNote /> : <ManyHoldersNote />;
}
