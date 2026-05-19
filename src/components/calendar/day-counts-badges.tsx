import { cn } from '@/lib/cn';
import type { DayCounts } from '@/server/services/bookings-query';

interface Props {
  counts: DayCounts | undefined;
  size: 'compact' | 'expanded';
}

/**
 * Two distinct pills: amber for unassigned (needs operator attention),
 * muted blue for dispatched (handled). Designed to be unambiguous at a
 * glance.
 *
 * `compact` — used in the popover; abbreviated, just numbers + icon.
 * `expanded` — used on the full-page calendar; full labels.
 */
export function DayCountsBadges({ counts, size }: Props) {
  if (!counts || counts.total === 0) {
    return size === 'expanded' ? (
      <span className="text-2xs italic text-ink-disabled">No bookings</span>
    ) : null;
  }

  const compact = size === 'compact';

  return (
    <div className={cn('flex flex-wrap items-center', compact ? 'gap-1' : 'gap-1.5')}>
      {counts.unassigned > 0 ? (
        <Pill tone="warning" compact={compact}>
          <span aria-hidden>●</span>
          <span className="font-semibold tabular-nums">{counts.unassigned}</span>
          {!compact ? <span>unassigned</span> : null}
        </Pill>
      ) : null}

      {counts.dispatched > 0 ? (
        <Pill tone="muted" compact={compact}>
          <span aria-hidden>●</span>
          <span className="font-semibold tabular-nums">{counts.dispatched}</span>
          {!compact ? <span>dispatched</span> : null}
        </Pill>
      ) : null}
    </div>
  );
}

function Pill({
  tone,
  compact,
  children,
}: {
  tone: 'warning' | 'muted';
  compact: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium',
        compact ? 'px-1.5 py-0 text-2xs' : 'px-2 py-0.5 text-xs',
        tone === 'warning'
          ? 'bg-warning-100 text-warning-900 [&_[aria-hidden]]:text-warning-700'
          : 'bg-brand-50 text-brand-800 [&_[aria-hidden]]:text-brand-600',
      )}
    >
      {children}
    </span>
  );
}
