import { Download, FileUp, Play, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { toast } from 'sonner';
import type { BulkJobRecord, BulkRowRecord } from '@shared/records';
import { CsvDialog, type CsvFile } from '@/components/CsvDialog';
import { EmptyState, PageLoading } from '@/components/EmptyState';
import { PageHeader } from '@/components/Layout';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { requireBackend } from '@/lib/backend';
import { BULK_CONCURRENCY, collectExportRows, runBulkJob } from '@/lib/bulkRunner';
import { DEMO_TEMPLATE_CSV, MAX_BULK_ROWS, TEMPLATE_CSV, buildResultsCsv, downloadTextFile, parseBulkCsv, type ParsedRow } from '@/lib/csv';
import { DEMO_MODE } from '@/lib/config';
import { cn, errorMessage, formatDateTime } from '@/lib/utils';

const MAX_FILE_BYTES = 1024 * 1024;

interface Preview {
  fileName: string;
  rows: ParsedRow[];
  fileError: string | null;
}

function ProgressBar({ processed, total }: { processed: number; total: number }) {
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-[15px]">
        <span>
          <span className="tabular font-semibold">{processed}</span> of <span className="tabular">{total}</span> rows processed
        </span>
        <span className="tabular text-muted">{pct}%</span>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-sunken"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={processed}
        aria-label="Bulk search progress"
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function BulkPage() {
  const backend = requireBackend();
  const [jobs, setJobs] = useState<BulkJobRecord[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dragging, setDragging] = useState(false);
  const [creating, setCreating] = useState(false);
  const [activeJob, setActiveJob] = useState<BulkJobRecord | null>(null);
  const [activeRows, setActiveRows] = useState<BulkRowRecord[]>([]);
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [running, setRunning] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<BulkJobRecord | null>(null);
  const [csvFile, setCsvFile] = useState<CsvFile | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const stopRef = useRef(false);

  // The demo shows files in a dialog (hosted previews may block downloads); the real app downloads directly.
  const offerCsv = (fileName: string, content: string) =>
    DEMO_MODE ? setCsvFile({ fileName, content }) : downloadTextFile(fileName, content);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadJobs = useCallback(async () => {
    try {
      setJobs(await backend.bulk.listJobs());
    } catch (error) {
      toast.error(errorMessage(error));
      setJobs([]);
    }
  }, [backend]);

  useEffect(() => {
    let active = true;
    backend.bulk
      .listJobs()
      .then((list) => active && setJobs(list))
      .catch((error: unknown) => {
        if (!active) return;
        toast.error(errorMessage(error));
        setJobs([]);
      });
    return () => {
      active = false;
      // Leaving the page stops taking new rows; unfinished rows stay saved for "Resume".
      stopRef.current = true;
    };
  }, [backend]);

  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);

  const readFile = async (file: File) => {
    if (file.size > MAX_FILE_BYTES)
      return toast.error('That file is larger than 1 MB. A 100-row CSV is usually a few KB — check you picked the right file.');
    if (!/\.(csv|txt)$/i.test(file.name) && file.type && !/csv|text\/plain/.test(file.type))
      return toast.error('Please choose a .csv file.');
    const text = await file.text();
    setPreview({ fileName: file.name, ...parseBulkCsv(text) });
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void readFile(file);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void readFile(file);
  };

  const run = async (job: BulkJobRecord) => {
    stopRef.current = false;
    setActiveJob(job);
    setRunning(true);
    try {
      setActiveRows(await backend.bulk.listRows(job.id));
      const result = await runBulkJob(backend, job.id, {
        onProgress: (processed, total) => setProgress({ processed, total }),
        onRowDone: (row) => setActiveRows((rows) => rows.map((r) => (r.id === row.id ? row : r))),
        shouldStop: () => stopRef.current,
      });
      if (result.outcome === 'completed') toast.success(`Bulk search finished: ${job.fileName}`);
      if (result.outcome === 'paused_rate_limit')
        toast.warning(`${result.message ?? 'Hourly limit reached.'} Use Resume later to continue.`);
      setActiveRows(await backend.bulk.listRows(job.id));
      setActiveJob(await backend.bulk.getJob(job.id));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRunning(false);
      void loadJobs();
    }
  };

  const start = async () => {
    if (!preview || preview.fileError) return;
    setCreating(true);
    try {
      const job = await backend.bulk.createJob(
        preview.fileName,
        preview.rows.map((row) => ({ companyUrl: row.companyUrl, position: row.position, error: row.error })),
      );
      setPreview(null);
      setProgress({ processed: job.processedRows, total: job.totalRows });
      await loadJobs();
      void run(job);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  const exportBase = (job: BulkJobRecord) => `${job.fileName.replace(/\.(csv|txt)$/i, '')}-results`;

  const download = async (job: BulkJobRecord) => {
    try {
      const csv = buildResultsCsv(await collectExportRows(backend, job.id));
      offerCsv(`${exportBase(job)}.csv`, csv);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  // Formatted Excel workbook (real app). exceljs is loaded only when someone downloads.
  const downloadExcel = async (job: BulkJobRecord) => {
    setExporting(job.id);
    try {
      const rows = await collectExportRows(backend, job.id);
      const { downloadResultsXlsx } = await import('@/lib/xlsxExport');
      await downloadResultsXlsx(rows, { fileName: job.fileName, exportedAt: new Date() }, `${exportBase(job)}.xlsx`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setExporting(null);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    try {
      await backend.bulk.deleteJob(pendingDelete.id);
      if (activeJob?.id === pendingDelete.id) setActiveJob(null);
      toast.success('Bulk job deleted');
      setPendingDelete(null);
      void loadJobs();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const validCount = preview?.rows.filter((r) => !r.error).length ?? 0;
  const invalidCount = (preview?.rows.length ?? 0) - validCount;

  return (
    <>
      <PageHeader
        title="Bulk search"
        description={`Upload a CSV with up to ${MAX_BULK_ROWS} companies and positions. Rows are searched ${BULK_CONCURRENCY} at a time; you can leave and resume later.`}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => offerCsv('profilefinder-template.csv', DEMO_MODE ? DEMO_TEMPLATE_CSV : TEMPLATE_CSV)}
          >
            <Download className="size-4" aria-hidden="true" />
            Download CSV template
          </Button>
        }
      />

      {!preview && !running && (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex cursor-pointer flex-col items-start gap-3 rounded-lg border-2 border-dashed px-5 py-8 transition-colors sm:flex-row sm:items-center sm:gap-5',
            dragging ? 'border-accent bg-accent-soft' : 'border-line-strong hover:border-accent',
          )}
        >
          <FileUp className="size-8 shrink-0 text-accent" aria-hidden="true" />
          <span className="flex flex-col gap-1">
            <span className="text-[17px] font-semibold">Choose a CSV file or drop it here</span>
            <span className="text-[15px] text-muted">
              Header row required: <code className="rounded bg-sunken px-1 py-0.5 text-sm">company_url,position</code> (or{' '}
              <code className="rounded bg-sunken px-1 py-0.5 text-sm">company,title</code>).
            </span>
          </span>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} />
        </label>
      )}

      {DEMO_MODE && !preview && !running && (
        <p className="mt-3 text-[15px] text-muted">
          No CSV at hand?{' '}
          <button
            type="button"
            className="font-medium text-accent underline-offset-4 hover:underline"
            onClick={() => setPreview({ fileName: 'demo-sample.csv', ...parseBulkCsv(DEMO_TEMPLATE_CSV) })}
          >
            Load the demo sample
          </button>{' '}
          (7 fictional companies, including one that fails on purpose).
        </p>
      )}

      {preview && (
        <section className="flex flex-col gap-5" aria-labelledby="preview-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="preview-heading" className="text-xl font-semibold">
                {preview.fileName}
              </h2>
              {!preview.fileError && (
                <p className="text-[15px] text-muted">
                  {validCount} {validCount === 1 ? 'row' : 'rows'} ready
                  {invalidCount > 0 && <>, {invalidCount} with problems (they'll be marked as failed and skipped)</>}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setPreview(null)}>
                Choose another file
              </Button>
              {!preview.fileError && (
                <Button onClick={() => void start()} loading={creating} disabled={validCount === 0}>
                  <Play className="size-4" aria-hidden="true" />
                  Start bulk search
                </Button>
              )}
            </div>
          </div>

          {preview.fileError ? (
            <p className="rounded-md bg-danger-soft px-4 py-3 text-[15px] text-danger" role="alert">
              {preview.fileError}
            </p>
          ) : (
            <div className="max-h-[28rem] overflow-auto rounded-lg border border-line bg-surface">
              <table className="w-full border-collapse text-left text-[15px]">
                <thead className="sticky top-0 bg-surface text-sm text-muted shadow-[0_1px_0_var(--line)]">
                  <tr>
                    <th scope="col" className="w-12 px-3 py-2.5 font-medium">
                      #
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Company
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Position
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Check
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {preview.rows.map((row) => (
                    <tr key={row.index} className={row.error ? 'bg-danger-soft/40' : undefined}>
                      <td className="tabular px-3 py-2 text-muted">{row.index + 1}</td>
                      <td className="max-w-[16rem] truncate px-3 py-2">{row.companyUrl || <span className="text-muted">empty</span>}</td>
                      <td className="max-w-[14rem] truncate px-3 py-2">{row.position || <span className="text-muted">empty</span>}</td>
                      <td className={cn('px-3 py-2 text-sm', row.error ? 'text-danger' : 'text-high')}>{row.error ?? 'OK'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeJob && (running || activeRows.length > 0) && (
        <section className="mt-10 flex flex-col gap-5" aria-labelledby="active-heading" aria-live="polite">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="active-heading" className="text-xl font-semibold">
                {activeJob.fileName}
              </h2>
              <p className="text-[15px] text-muted">
                {running
                  ? 'Running — you can leave this page; unfinished rows wait for Resume.'
                  : activeJob.status === 'completed' || activeJob.status === 'failed'
                    ? 'Finished.'
                    : 'Paused.'}
              </p>
            </div>
            {!running &&
              activeJob.processedRows > 0 &&
              (DEMO_MODE ? (
                <Button onClick={() => void download(activeJob)}>
                  <Download className="size-4" aria-hidden="true" />
                  Download results CSV
                </Button>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void downloadExcel(activeJob)} loading={exporting === activeJob.id}>
                    {exporting !== activeJob.id && <Download className="size-4" aria-hidden="true" />}
                    Download Excel
                  </Button>
                  <Button variant="secondary" onClick={() => void download(activeJob)}>
                    CSV
                  </Button>
                </div>
              ))}
          </div>
          <ProgressBar
            processed={running ? progress.processed : activeJob.processedRows}
            total={running ? progress.total : activeJob.totalRows}
          />
          <ol className="divide-y divide-line rounded-lg border border-line bg-surface text-[15px]">
            {activeRows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="tabular mr-3 inline-block w-6 text-right text-muted">{row.rowIndex + 1}</span>
                  {row.position} at {row.companyUrl || 'empty'}
                  {row.error && row.status === 'failed' && <span className="block pl-9 text-sm text-danger">{row.error}</span>}
                </span>
                <StatusBadge status={row.status} label={row.status === 'completed' ? 'Done' : undefined} />
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="mt-12 flex flex-col gap-4" aria-labelledby="jobs-heading">
        <h2 id="jobs-heading" className="text-xl font-semibold">
          Your bulk jobs
        </h2>
        {!jobs && <PageLoading label="Loading bulk jobs…" />}
        {jobs && jobs.length === 0 && (
          <EmptyState title="No bulk jobs yet">Upload a CSV above. The template has the right columns.</EmptyState>
        )}
        {jobs && jobs.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {jobs.map((job) => {
              const unfinished = job.processedRows < job.totalRows;
              const isActive = running && activeJob?.id === job.id;
              return (
                <li key={job.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{job.fileName}</p>
                    <p className="text-sm text-muted">
                      {formatDateTime(job.createdAt)}, <span className="tabular">{job.processedRows}</span>/
                      <span className="tabular">{job.totalRows}</span> rows
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      status={isActive ? 'running' : unfinished ? 'pending' : job.status === 'failed' ? 'failed' : 'completed'}
                      label={isActive ? 'Running' : unfinished ? 'Unfinished' : job.status === 'failed' ? 'All rows failed' : 'Finished'}
                    />
                    {unfinished && !isActive && (
                      <Button size="sm" onClick={() => void run(job)} disabled={running}>
                        <Play className="size-4" aria-hidden="true" />
                        Resume
                      </Button>
                    )}
                    {job.processedRows > 0 && !isActive && !DEMO_MODE && (
                      <Button variant="secondary" size="sm" onClick={() => void downloadExcel(job)} loading={exporting === job.id}>
                        {exporting !== job.id && <Download className="size-4" aria-hidden="true" />}
                        Excel
                      </Button>
                    )}
                    {job.processedRows > 0 && !isActive && (
                      <Button variant="secondary" size="sm" onClick={() => void download(job)}>
                        {DEMO_MODE && <Download className="size-4" aria-hidden="true" />}
                        {DEMO_MODE ? 'Results CSV' : 'CSV'}
                      </Button>
                    )}
                    {!isActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingDelete(job)}
                        aria-label={`Delete bulk job ${job.fileName}`}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <CsvDialog file={csvFile} onClose={() => setCsvFile(null)} />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this bulk job?"
        description="The job and its row list are deleted. Searches it already ran stay in your History."
        confirmLabel="Delete job"
        onConfirm={() => void remove()}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
