import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { SearchRecord } from '@shared/records';
import { EmptyState, PageLoading } from '@/components/EmptyState';
import { PageHeader } from '@/components/Layout';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/Button';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { requireBackend } from '@/lib/backend';
import { errorMessage, formatDateTime } from '@/lib/utils';

export function HistoryPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<SearchRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SearchRecord | 'all' | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    requireBackend()
      .history.list()
      .then((list) => active && setItems(list))
      .catch((error: unknown) => active && setLoadError(errorMessage(error)));
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const retry = () => {
    setLoadError(null);
    setReloadKey((key) => key + 1);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (pendingDelete === 'all') {
        await requireBackend().history.removeAll();
        setItems([]);
        toast.success('History deleted');
      } else {
        await requireBackend().history.remove(pendingDelete.id);
        setItems((current) => current?.filter((item) => item.id !== pendingDelete.id) ?? null);
        toast.success('Search deleted');
      }
      setPendingDelete(null);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="History"
        description="Every search you've run, newest first. Open one to see its saved results."
        actions={
          items && items.length > 0 ? (
            <Button variant="danger" size="sm" onClick={() => setPendingDelete('all')}>
              <Trash2 className="size-4" aria-hidden="true" />
              Delete all history
            </Button>
          ) : null
        }
      />

      {loadError && (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-danger-soft px-4 py-3 text-[15px] text-danger" role="alert">
          {loadError}
          <Button variant="secondary" size="sm" onClick={retry}>
            Try again
          </Button>
        </div>
      )}

      {!items && !loadError && <PageLoading label="Loading your history…" />}

      {items && items.length === 0 && (
        <EmptyState
          title="No searches yet"
          action={
            <Link to="/app" className={buttonClasses('primary', 'md')}>
              Run your first search
            </Link>
          }
        >
          <p>Searches you run, one at a time or from a CSV, are saved here.</p>
        </EmptyState>
      )}

      {items && items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <table className="w-full border-collapse text-left text-[15px]">
            <thead className="hidden border-b border-line text-sm text-muted md:table-header-group">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Date
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Company
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Position
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Results
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="grid cursor-pointer grid-cols-[1fr_auto] gap-x-3 px-4 py-3 hover:bg-sunken md:table-row md:p-0"
                  onClick={() => navigate(`/app/history/${item.id}`)}
                >
                  <td className="order-3 col-span-2 text-sm text-muted md:order-none md:px-4 md:py-3 md:text-[15px] md:text-ink">
                    {formatDateTime(item.createdAt)}
                  </td>
                  <td className="order-1 min-w-0 md:order-none md:px-4 md:py-3">
                    <Link to={`/app/history/${item.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                      {item.companyName ?? item.domain ?? item.companyUrl}
                    </Link>
                    {item.companyName && item.domain && <span className="block text-sm text-muted">{item.domain}</span>}
                  </td>
                  <td className="order-2 col-span-2 md:order-none md:px-4 md:py-3">{item.position}</td>
                  <td className="tabular hidden text-right md:table-cell md:px-4 md:py-3">{item.resultCount}</td>
                  <td className="order-1 justify-self-end md:order-none md:px-4 md:py-3">
                    <StatusBadge status={item.status} label={item.status === 'completed' ? `${item.resultCount} found` : undefined} />
                    {item.fromCache && <span className="mt-1 block text-xs text-muted md:inline md:mt-0 md:ml-2">cached</span>}
                  </td>
                  <td className="order-4 col-span-2 md:order-none md:px-2 md:py-3 md:text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete search for ${item.position} at ${item.companyName ?? item.companyUrl}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDelete(item);
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      <span className="md:sr-only">Delete</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete === 'all' ? 'Delete all history?' : 'Delete this search?'}
        description={
          pendingDelete === 'all'
            ? 'This permanently deletes every saved search, its results and your bulk jobs. This cannot be undone.'
            : 'The search and its saved results will be permanently deleted.'
        }
        confirmLabel={pendingDelete === 'all' ? 'Delete all' : 'Delete search'}
        requireText={pendingDelete === 'all' ? 'DELETE' : undefined}
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
