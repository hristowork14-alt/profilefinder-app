import { Check, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { RankedProfile } from '@shared/types';
import { copyToClipboard } from '@/lib/utils';
import { Button } from './ui/Button';
import { buttonClasses } from './ui/buttonStyles';
import { ConfidenceBadge } from './ConfidenceBadge';

/** One ranked person. Rendered as a row in a ranked list, not a floating card. */
export function ResultCard({ result, rank, animate = false }: { result: RankedProfile; rank: number; animate?: boolean }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (await copyToClipboard(result.linkedinUrl)) {
      setCopied(true);
      toast.success('LinkedIn URL copied');
      setTimeout(() => setCopied(false), 1800);
    } else {
      toast.error('Could not copy. Select the address and copy it manually.');
    }
  };

  return (
    <li className={animate ? 'rank-in' : undefined} style={animate ? { animationDelay: `${(rank - 1) * 70}ms` } : undefined}>
      <article className="grid grid-cols-[2.25rem_1fr] gap-x-4 gap-y-3 py-5 sm:grid-cols-[3rem_1fr_auto]">
        <span className="tabular row-span-2 text-3xl leading-none font-light text-muted sm:text-4xl" aria-label={`Rank ${rank}`}>
          {rank}
        </span>
        <div className="min-w-0">
          <h3 className="text-lg leading-snug font-semibold break-words">{result.fullName}</h3>
          {result.headline && <p className="mt-0.5 text-[15px] break-words text-muted">{result.headline}</p>}
        </div>
        <ConfidenceBadge confidence={result.confidence} className="col-start-2 items-start sm:col-start-3 sm:row-start-1 sm:items-end" />
        <div className="col-start-2 flex flex-col gap-3 sm:col-span-2">
          {result.reasoning && <p className="max-w-[68ch] text-[15px] text-ink/85">{result.reasoning}</p>}
          <div className="flex flex-wrap gap-2">
            <a href={result.linkedinUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary', 'sm')}>
              <ExternalLink className="size-4" aria-hidden="true" />
              Open LinkedIn
            </a>
            <Button variant="ghost" size="sm" onClick={copy} aria-label={`Copy LinkedIn URL of ${result.fullName}`}>
              {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy URL'}
            </Button>
          </div>
        </div>
      </article>
    </li>
  );
}

export function ResultList({ results, animate = false }: { results: RankedProfile[]; animate?: boolean }) {
  return (
    <ol className="divide-y divide-line border-y border-line">
      {results.map((result, index) => (
        <ResultCard key={result.linkedinUrl} result={result} rank={index + 1} animate={animate} />
      ))}
    </ol>
  );
}
