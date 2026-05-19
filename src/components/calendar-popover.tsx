import { cn } from '@/lib/cn';
import { calendarGrid, formatLondonMonthLong, londonTodayString, offsetMonth } from '@/lib/dates';
import type { DayCounts } from '@/server/services/bookings-query';
import Link from 'next/link';

interface Props {
  /** Currently selected day in YYYY-MM-DD (London) */
  selectedDay: string;
  /** Month currently shown in the calendar in YYYY-MM (London). May differ from selectedDay's month. */
  visibleMonth: string;
  /** Per-day counts to render in the grid cells. Keys are YYYY-MM-DD. */
  counts: Map<string, DayCounts>;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Server-rendered calendar in a native <details> popover. No client JS.
 * Clicking a day navigates to /dashboard?date=YYYY-MM-DD&calMonth=YYYY-MM.
 */
export function CalendarPopover({ selectedDay, visibleMonth, counts }: Props) {
  const today = londonTodayString();
  const prevMonth = offsetMonth(visibleMonth, -1);
  const nextMonth = offsetMonth(visibleMonth, 1);
  const days = calendarGrid(visibleMonth);

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
        <span>{selectedDay === today ? 'Today' : selectedDay}</span>
        <span className="text-ink-muted text-xs group-open:rotate-180 transition-transform">▾</span>
      </summary>

      <div className="absolute left-0 z-30 mt-2 w-[320px] rounded-md border border-border bg-surface p-3 shadow-overlay">
        <div className="mb-2 flex items-center justify-between">
          <Link
            href={`/dashboard?date=${selectedDay}&calMonth=${prevMonth}`}
            className="rounded p-1 text-ink-subtle hover:bg-neutral-100"
            aria-label="Previous month"
          >
            ‹
          </Link>
          <div className="text-sm font-semibold text-ink">
            {formatLondonMonthLong(visibleMonth)}
          </div>
          <Link
            href={`/dashboard?date=${selectedDay}&calMonth=${nextMonth}`}
            className="rounded p-1 text-ink-subtle hover:bg-neutral-100"
            aria-label="Next month"
          >
            ›
          </Link>
        </div>

        <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-2xs font-semibold uppercase text-ink-muted">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-0.5">
          {days.map((day) => {
            const inMonth = day.startsWith(visibleMonth);
            const isToday = day === today;
            const isSelected = day === selectedDay;
            const c = counts.get(day);
            const dayNumber = Number(day.slice(8, 10));
            return (
              <Link
                key={day}
                href={`/dashboard?date=${day}&calMonth=${day.slice(0, 7)}`}
                aria-label={`${day}${c ? `, ${c.total} bookings, ${c.unassigned} unassigned` : ''}`}
                className={cn(
                  'flex aspect-square min-h-10 flex-col items-center justify-center rounded border text-xs',
                  inMonth ? 'text-ink' : 'text-ink-disabled',
                  isSelected
                    ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700'
                    : isToday
                      ? 'border-brand-300 bg-brand-50/40 font-semibold'
                      : 'border-transparent hover:bg-neutral-100',
                )}
              >
                <span className="leading-tight">{dayNumber}</span>
                {c ? (
                  <span
                    className={cn(
                      'text-2xs leading-tight',
                      c.unassigned > 0 ? 'text-warning-700 font-semibold' : 'text-ink-muted',
                    )}
                  >
                    {c.total}
                    {c.unassigned > 0 ? <span> · {c.unassigned}</span> : null}
                  </span>
                ) : (
                  <span className="text-2xs leading-tight text-transparent">·</span>
                )}
              </Link>
            );
          })}
        </div>

        <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-xs">
          <Link
            href={`/dashboard?date=${today}&calMonth=${today.slice(0, 7)}`}
            className="font-medium text-brand-700 hover:underline"
          >
            Jump to today
          </Link>
          <span className="text-ink-muted">
            <span className="font-medium text-ink-subtle">N</span> total ·{' '}
            <span className="font-medium text-warning-700">M</span> unassigned
          </span>
        </div>
      </div>
    </details>
  );
}
