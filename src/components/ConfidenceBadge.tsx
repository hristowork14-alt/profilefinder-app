import { cn, confidenceTier } from '@/lib/utils';

const tierStyles = {
  high: { badge: 'bg-high-soft text-high', bar: 'bg-high', label: 'High' },
  mid: { badge: 'bg-mid-soft text-mid', bar: 'bg-mid', label: 'Medium' },
  low: { badge: 'bg-low-soft text-low', bar: 'bg-low', label: 'Low' },
} as const;

/** Confidence as a number badge (green ≥ 75, yellow 50–74, gray < 50) with a thin meter. */
export function ConfidenceBadge({
  confidence,
  showMeter = true,
  className,
}: {
  confidence: number;
  showMeter?: boolean;
  className?: string;
}) {
  const tier = tierStyles[confidenceTier(confidence)];
  return (
    <div className={cn('flex flex-col items-end gap-1.5', className)}>
      <span
        className={cn('tabular inline-flex items-baseline gap-1 rounded px-2 py-0.5 text-sm font-semibold', tier.badge)}
        title={`${tier.label} confidence`}
      >
        {confidence}
        <span className="text-xs font-medium opacity-80">%</span>
        <span className="sr-only">{tier.label} confidence</span>
      </span>
      {showMeter && (
        <span className="block h-1 w-20 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
          <span className={cn('meter-fill block h-full rounded-full', tier.bar)} style={{ width: `${Math.max(4, confidence)}%` }} />
        </span>
      )}
    </div>
  );
}
