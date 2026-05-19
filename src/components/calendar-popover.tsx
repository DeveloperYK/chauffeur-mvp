import { CalendarGrid } from '@/components/calendar/calendar-grid';
import { cn } from '@/lib/cn';
import { londonTodayString } from '@/lib/dates';
import type { DayCounts } from '@/server/services/bookings-query';

interface Props {
  selectedDay: string;
  visibleMonth: string;
  counts: Map<string, DayCounts>;
}

/**
 * Calendar popover — a native <details> with the shared month grid inside.
 * No client JS. Clicking a day navigates via Next.js Link.
 */
export function CalendarPopover({ selectedDay, visibleMonth, counts }: Props) {
  const today = londonTodayString();
  const selectedSummary = selectedDay === today ? 'Today' : selectedDay;

  return (
    <details className="group relative">
      <summary
        className={cn(
          'inline-flex cursor-pointer items-center gap-1.5 rounded border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink',
          'hover:bg-neutral-50 group-open:bg-neutral-50',
          'list-none [&::-webkit-details-marker]:hidden',
        )}
      >
        <span aria-hidden>📅</span>
        <span>{selectedSummary}</span>
        <span className="text-xs text-ink-muted transition-transform group-open:rotate-180">▾</span>
      </summary>

      <div className="absolute left-0 z-30 mt-2 rounded-md border border-border bg-surface p-3 shadow-overlay">
        <CalendarGrid
          selectedDay={selectedDay}
          visibleMonth={visibleMonth}
          counts={counts}
          variant="compact"
        />
      </div>
    </details>
  );
}
