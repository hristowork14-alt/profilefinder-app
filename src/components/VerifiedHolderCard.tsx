import { AlertTriangle, BadgeCheck, ExternalLink, Info, Search, Users } from 'lucide-react';
import { isSingleHolderRole } from '@shared/roleKind';
import type { SearchResponse, SourceLink, VerifiedHolder } from '@shared/types';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The independent pages that name the person, each with the sentence that does so. */
export function SourceList({ links, sources }: { links: SourceLink[]; sources: number }) {
  if (links.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-3">
      <p className="text-sm font-medium text-muted">
        {sources <= 1
          ? 'Named by 1 independent website:'
          : `Confirmed by ${plural(sources, 'independent website', 'independent websites')}, for example:`}
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

/**
 * The person independent sources name for the role: when no profile was found, or above a
 * profile that is "likely" or matched by name only.
 */
export function VerifiedHolderCard({
  holder,
  position,
  companyName,
  decision,
  hasProfile = false,
}: {
  holder: VerifiedHolder;
  position: string;
  companyName: string;
  decision?: SearchResponse['decision'];
  /** A profile is listed below the card. */
  hasProfile?: boolean;
}) {
  const likely = decision === 'likely';
  const role = holder.role ?? position;
  const lead = likely
    ? `One independent source names the ${role} at ${companyName} as`
    : holder.role
      ? `Independent sources name the ${holder.role} at ${companyName} — the top role for “${position}” — as`
      : `Independent sources say the ${position} at ${companyName} is`;
  const Icon = likely ? Info : BadgeCheck;
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface px-5 py-5">
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 size-5 shrink-0 ${likely ? 'text-mid' : 'text-high'}`} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[15px] text-muted">{lead}</p>
          <p className="text-2xl font-semibold tracking-tight break-words">{holder.name}</p>
          {likely && <p className="mt-1 text-[15px] text-mid">Likely — only one source says so. Check before using.</p>}
          {!hasProfile && <p className="mt-1 text-[15px] text-muted">No public LinkedIn profile was found for this person.</p>}
          {hasProfile && decision === 'verified_name_match' && (
            <p className="mt-1 text-[15px] text-muted">
              The profile below is the only one with this exact name, but it doesn’t mention {companyName} — check it before using.
            </p>
          )}
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

/** Shown above closest matches: nobody had the exact title. */
export function ClosestNote({ position, triedTitles }: { position: string; triedTitles?: string[] }) {
  return (
    <p className="flex items-start gap-2 rounded-md bg-low-soft px-4 py-3 text-[15px] text-low">
      <Search className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        No one with the exact title “{position}” was found, so these are the closest matches at the company.
        {triedTitles && triedTitles.length > 0 && <> Also searched for: {triedTitles.join(', ')}.</>}
      </span>
    </p>
  );
}

/** The right note above a result list, depending on how the answer was reached. */
export function VerificationNote({
  decision,
  verifiedHolder,
  position,
  triedTitles,
}: {
  decision?: SearchResponse['decision'];
  verifiedHolder?: VerifiedHolder | null;
  position: string;
  triedTitles?: string[];
}) {
  if (decision === 'contradicted') return <ConflictNote />;
  if (decision === 'closest') return <ClosestNote position={position} triedTitles={triedTitles} />;
  if (decision === 'likely' || decision === 'verified_name_match') return null;
  // verifiedHolder === null (or the stored outcome "unverified"): verification ran and nobody could be confirmed.
  if (verifiedHolder !== null && decision !== 'unverified') return null;
  return isSingleHolderRole(position) ? <UnverifiedNote /> : <ManyHoldersNote />;
}
