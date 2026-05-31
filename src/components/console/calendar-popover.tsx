'use client';

import { dayCountsAction } from '@/app/(dashboard)/dashboard/console-actions';
import { calendarGrid, formatLondonMonthLong, londonTodayString, offsetMonth } from '@/lib/dates';
import type { DayCounts } from '@/server/services/bookings-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface Props {
  selectedDay: string;
  visibleMonth: string;
  counts: Record<string, DayCounts>;
}

export function CalendarPopover({ selectedDay, visibleMonth, counts }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(visibleMonth);
  // Counts cached per month (YYYY-MM). Seeded with the server-rendered month;
  // other months are lazy-loaded when the operator pages to them, so the day
  // badges show without a full navigation.
  const [countsByMonth, setCountsByMonth] = useState<Record<string, Record<string, DayCounts>>>({
    [visibleMonth]: counts,
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setMonth(visibleMonth), [visibleMonth]);
  // Keep the server-rendered month's counts fresh (e.g. after a mutation).
  useEffect(() => {
    setCountsByMonth((prev) => ({ ...prev, [visibleMonth]: counts }));
  }, [visibleMonth, counts]);
  // Lazy-load counts for whatever month is on screen if we don't have them yet.
  useEffect(() => {
    if (countsByMonth[month]) return;
    let cancelled = false;
    dayCountsAction(month).then((c) => {
      if (!cancelled) setCountsByMonth((prev) => ({ ...prev, [month]: c }));
    });
    return () => {
      cancelled = true;
    };
  }, [month, countsByMonth]);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const today = londonTodayString();
  const label =
    selectedDay === today
      ? 'Today'
      : new Date(`${selectedDay}T12:00:00Z`).toLocaleDateString('en-GB', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          timeZone: 'Europe/London',
        });

  const go = (day: string) => {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.set('date', day);
    params.set('calMonth', day.slice(0, 7));
    params.delete('savedView');
    setOpen(false);
    router.push(`/dashboard?${params.toString()}`);
  };

  const days = calendarGrid(month);
  const monthCounts = countsByMonth[month] ?? {};

  return (
    <div className="cal-pop" ref={ref}>
      <button type="button" className="cal-pop__trigger" onClick={() => setOpen((o) => !o)}>
        <Icon.Calendar />
        <span>{label}</span>
        <Icon.ChevDown className="chev" />
      </button>
      {open ? (
        <div className="cal-pop__panel">
          <div className="cal cal--compact">
            <div className="cal__head">
              <button
                type="button"
                className="icon-btn"
                onClick={() => setMonth(offsetMonth(month, -1))}
                aria-label="Previous month"
              >
                <Icon.ChevLeft />
              </button>
              <div className="cal__title">{formatLondonMonthLong(month)}</div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setMonth(offsetMonth(month, 1))}
                aria-label="Next month"
              >
                <Icon.ChevRight />
              </button>
            </div>
            <div className="cal__wk">
              {WEEKDAYS.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="cal__grid">
              {days.map((day) => {
                const inMonth = day.startsWith(month);
                const isToday = day === today;
                const isSelected = day === selectedDay;
                const c = monthCounts[day];
                const dayNum = Number(day.slice(8, 10));
                return (
                  <button
                    key={day}
                    type="button"
                    className={`cal__cell ${inMonth ? 'in-month' : 'out-month'} ${
                      isSelected ? 'is-selected' : ''
                    } ${isToday ? 'is-today' : ''}`}
                    onClick={() => go(day)}
                  >
                    <span className={`cal__num ${isToday ? 'is-today-pip' : ''}`}>{dayNum}</span>
                    {c && c.total > 0 ? (
                      <div className="dc-pills compact">
                        {c.unassigned > 0 ? (
                          <span className="dc-pill warning">
                            <span className="bullet" />
                            <span className="tabnum">{c.unassigned}</span>
                          </span>
                        ) : null}
                        {c.assigned > 0 ? (
                          <span className="dc-pill muted">
                            <span className="bullet" />
                            <span className="tabnum">{c.assigned}</span>
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="cal__foot">
              <button type="button" className="cal__today" onClick={() => go(today)}>
                Jump to today
              </button>
              <span className="cal__legend">
                <span className="lg">
                  <span className="bullet warning" />
                  Unassigned
                </span>
                <span className="lg">
                  <span className="bullet muted" />
                  Assigned
                </span>
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
