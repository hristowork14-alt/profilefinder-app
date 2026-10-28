import { ArrowLeft, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { SearchWithResults } from '@shared/records';
import { EmptyState, PageLoading } from '@/components/EmptyState';
import { ResultList } from '@/components/ResultCard';
import { StatusBadge } from '@/components/StatusBadge';
import { VerificationNote, VerifiedHolderCard } from '@/components/VerifiedHolderCard';
import { Button } from '@/components/ui/Button';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { requireBackend } from '@/lib/backend';
import { errorMessage, formatDateTime } from '@/lib/utils';

export function HistoryDetailPage() {
  const { searchId = '' } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState<SearchWithResults | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    requireBackend()
      .history.get(searchId)
      .then((found) => active && setSearch(found))
      .catch((err: unknown) => active && setError(errorMessage(err)));
    return () => {
      active = false;
    };
  }, [searchId]);

  const remove = async () => {
    setDeleting(true);
    try {
      await requireBackend().history.remove(searchId);
      toast.success('Search deleted');
      navigate('/app/history', { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
      setDeleting(false);
    }
  };

  const back = (
    <Link to="/app/history" className="inline-flex items-center gap-1.5 text-[15px] text-muted hover:text-ink">
      <ArrowLeft className="size-4" aria-hidden="true" />
      History
    </Link>
  );

  if (error)
    return (
      <div className="flex flex-col gap-6">
        {back}
        <p className="rounded-md bg-danger-soft px-4 py-3 text-danger" role="alert">
          {error}
        </p>
      </div>
    );
  if (search === undefined) return <PageLoading />;
  if (search === null)
    return (
      <div className="flex flex-col gap-6">
        {back}
        <EmptyState title="Search not found">This search may have been deleted.</EmptyState>
      </div>
    );

  const again = `/app?company=${encodeURIComponent(search.companyUrl)}&position=${encodeURIComponent(search.position)}`;

  return (
    <div className="flex flex-col gap-8">
      {back}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[15px] text-muted">{formatDateTime(search.createdAt)}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-[2.5rem] sm:leading-tight">
            {search.position} at {search.companyName ?? search.domain ?? search.companyUrl}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[15px] text-muted">
            <StatusBadge status={search.status} />
            {search.domain && <span>{search.domain}</span>}
            {search.fromCache && <span>Served from the 7-day cache</span>}
            {search.bulkJobId && <span>Part of a bulk job</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={again} className={buttonClasses('secondary', 'sm')}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Search again
          </Link>
          <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
            <Trash2 className="size-4" aria-hidden="true" />
            Delete
          </Button>
        </div>
      </div>

      {search.status === 'failed' && (
        <p className="rounded-md bg-danger-soft px-4 py-3 text-[15px] text-danger">{search.error ?? 'This search failed.'}</p>
      )}
      {search.results.length > 0 ? (
        <>
          <VerificationNote decision={search.decision} verifiedHolder={search.verifiedHolder} position={search.position} />
          <ResultList
            results={search.results}
            verifiedSources={search.verifiedHolder?.sources}
            sourceLinks={search.verifiedHolder?.sourceLinks}
          />
        </>
      ) : search.verifiedHolder ? (
        <VerifiedHolderCard
          holder={search.verifiedHolder}
          position={search.position}
          companyName={search.companyName ?? search.domain ?? search.companyUrl}
        />
      ) : (
        search.status !== 'failed' && <EmptyState title="No matching profiles were found">Try again with a broader title.</EmptyState>
      )}

      <ConfirmDialog
        open={confirming}
        title="Delete this search?"
        description="The search and its saved results will be permanently deleted."
        confirmLabel="Delete search"
        busy={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
