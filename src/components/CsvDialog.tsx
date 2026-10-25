import { Check, Copy, Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { downloadTextFile } from '@/lib/csv';
import { copyToClipboard } from '@/lib/utils';
import { Button } from './ui/Button';

export interface CsvFile {
  fileName: string;
  content: string;
}

/**
 * Demo-mode file viewer. Some hosted previews block file downloads, so the demo shows the
 * CSV text with a Copy button as well as trying a normal download.
 */
export function CsvDialog({ file, onClose }: { file: CsvFile | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (file && !dialog.open) dialog.showModal();
    if (!file && dialog.open) dialog.close();
  }, [file]);

  const copy = async () => {
    if (file && (await copyToClipboard(file.content))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(44rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40"
      aria-labelledby="csv-dialog-title"
    >
      {file && (
        <div className="flex flex-col gap-4 p-5">
          <div>
            <h2 id="csv-dialog-title" className="text-lg font-semibold break-all">
              {file.fileName}
            </h2>
            <p className="text-sm text-muted">Copy the text into a .csv file, or download it if your browser allows downloads here.</p>
          </div>
          <label className="sr-only" htmlFor="csv-dialog-text">
            CSV content
          </label>
          <textarea
            id="csv-dialog-text"
            readOnly
            value={file.content}
            className="tabular h-64 w-full resize-y rounded-md border border-line-strong bg-sunken p-3 font-mono text-[13px] leading-relaxed text-ink"
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button variant="secondary" onClick={() => downloadTextFile(file.fileName, file.content)}>
              <Download className="size-4" aria-hidden="true" />
              Download
            </Button>
            <Button onClick={() => void copy()}>
              {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy CSV'}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
