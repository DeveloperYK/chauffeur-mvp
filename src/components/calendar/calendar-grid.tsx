import { cn } from '@/lib/cn';
import { calendarGrid, formatLondonMonthLong, londonTodayString, offsetMonth } from '@/lib/dates';
import type { DayCounts } from '@/server/services/bookings-query';
import Link from 'next/link';
import { DayCountsBadges } from './day-counts-badges';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export type CalendarVariant = 'compact' | 'expanded';

interface Props {
  selectedDay: string;
  visibleMonth: string;
  counts: Map<string, DayCounts>;
  variant: CalendarVariant;
  /** Where day-cell clicks navigate. Defaults to '/dashboard' — the focused
   *  board view for that day. */
  dayHref?: string;
  /** Where prev/next-month + "Jump to today" buttons navigate. Defaults to
   *  the same as dayHref. Use this to keep month navigation on the calendar
   *  page while individual day clicks bounce to the board. */
  navHref?: string;
}

/**
 * Shared calendar month grid. Day cells show two clearly differentiated
 * count pills: unassigned (amber) and dispatched (muted blue).
 */
export function CalendarGrid({
  selectedDay,
  visibleMonth,
  counts,
  variant,
  dayHref = '/dashboard',
  navHref,
}: Props) {
  const navBase = navHref ?? dayHref;
  const today = londonTodayString();
  const prevMonth = offsetMonth(visibleMonth, -1);
  const nextMonth = offsetMonth(visibleMonth, 1);
  const days = calendarGrid(visibleMonth);
  const expanded = variant === 'expanded';

  const cellHeight = expanded ? 'min-h-[96px]' : 'aspect-square min-h-12';

  return (
    <div className={cn(expanded ? 'w-full' : 'w-[340px]')}>
      <div className="mb-3 flex items-center justify-between">
        <Link
          href={`${navBase}?date=${selectedDay}&calMonth=${prevMonth}`}
          className="rounded p-1 text-ink-subtle hover:bg-neutral-100"
          aria-label="Previous month"
        >
          ‹
        </Link>
        <div className={cn('font-semibold text-ink', expanded ? 'text-base' : 'text-sm')}>
          {formatLondonMonthLong(visibleMonth)}
        </div>
        <Link
          href={`${navBase}?date=${selectedDay}&calMonth=${nextMonth}`}
          className="rounded p-1 text-ink-subtle hover:bg-neutral-100"
          aria-label="Next month"
        >
          ›
        </Link>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-2xs font-semibold uppercase text-ink-muted">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const inMonth = day.startsWith(visibleMonth);
          const isToday = day === today;
          const isSelected = day === selectedDay;
          const c = counts.get(day);
          const dayNumber = Number(day.slice(8, 10));

          return (
            <Link
              key={day}
              href={`${dayHref}?date=${day}&calMonth=${day.slice(0, 7)}`}
              aria-label={`${day}${
                c
                  ? `, ${c.total} bookings — ${c.unassigned} unassigned, ${c.dispatched} dispatched`
                  : ', no bookings'
              }`}
              className={cn(
                'flex flex-col rounded-md border p-1.5 text-xs transition-colors',
                cellHeight,
                inMonth ? 'bg-surface' : 'bg-surface-sunken/40',
                isSelected
                  ? 'border-brand-500 ring-1 ring-brand-300'
                  : isToday
                    ? 'border-brand-300'
                    : 'border-border hover:border-brand-200 hover:bg-brand-50/30',
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={cn(
                    'tabular-nums',
                    isToday
                      ? 'inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 font-bold text-white'
                      : isSelected
                        ? 'font-semibold text-brand-700'
                        : inMonth
                          ? 'font-semibold text-ink'
                          : 'text-ink-disabled',
                  )}
                >
                  {dayNumber}
                </span>
              </div>

              <DayCountsBadges counts={c} size={expanded ? 'expanded' : 'compact'} />
            </Link>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        <Link
          href={`${navBase}?date=${today}&calMonth=${today.slice(0, 7)}`}
          className="font-medium text-brand-700 hover:underline"
        >
          Jump to today
        </Link>
        <span className="flex items-center gap-3 text-ink-muted">
          <span className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-warning-500" />
            Unassigned
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-brand-400" />
            Dispatched
          </span>
        </span>
      </div>
    </div>
  );
}
