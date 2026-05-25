import { Icon } from '@/components/console/icons';
import { Lozenge } from '@/components/console/lozenge';
import {
  calendarGrid,
  formatLondonMonth,
  formatLondonMonthLong,
  londonTodayString,
  offsetMonth,
  parseDayString,
  parseMonthString,
} from '@/lib/dates';
import { env } from '@/lib/env';
import { getDb } from '@/server/db';
import { monthlyDayCounts } from '@/server/services/bookings-query';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; calMonth?: string }>;
}) {
  const url = env().DATABASE_URL;
  if (!url) return <div className="content">DATABASE_URL not configured.</div>;
  const { db } = getDb(url);
  const params = await searchParams;
  const today = londonTodayString();
  const selectedDay = params.date && parseDayString(params.date) ? params.date : today;
  const visibleMonth =
    params.calMonth && parseMonthString(params.calMonth)
      ? params.calMonth
      : formatLondonMonth(new Date(`${selectedDay}T12:00:00Z`));

  const counts = await monthlyDayCounts(db, visibleMonth);
  let totalThisMonth = 0;
  let unassignedThisMonth = 0;
  for (const c of counts.values()) {
    totalThisMonth += c.total;
    unassignedThisMonth += c.unassigned;
  }

  const days = calendarGrid(visibleMonth);
  const navHref = (month: string, day: string) =>
    `/dashboard/calendar?date=${day}&calMonth=${month}`;

  return (
    <>
      <div className="page-head">
        <div className="page-head__row">
          <h1 className="page-head__title">Calendar</h1>
          <span className="page-head__sub dotsep-pre">{formatLondonMonthLong(visibleMonth)}</span>
          <span className="page-head__sub dotsep-pre">
            <b className="tabnum">{totalThisMonth}</b> bookings
          </span>
          {unassignedThisMonth > 0 ? (
            <Lozenge tone="orange">{unassignedThisMonth} UNASSIGNED</Lozenge>
          ) : null}
        </div>
      </div>

      <div className="content">
        <div className="card-shell">
          <div className="cal cal--expanded">
            <div className="cal__head">
              <Link
                className="icon-btn"
                href={navHref(offsetMonth(visibleMonth, -1), selectedDay)}
                aria-label="Previous month"
              >
                <Icon.ChevLeft />
              </Link>
              <div className="cal__title">{formatLondonMonthLong(visibleMonth)}</div>
              <Link
                className="icon-btn"
                href={navHref(offsetMonth(visibleMonth, 1), selectedDay)}
                aria-label="Next month"
              >
                <Icon.ChevRight />
              </Link>
            </div>
            <div className="cal__wk">
              {WEEKDAYS.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="cal__grid">
              {days.map((day) => {
                const inMonth = day.startsWith(visibleMonth);
                const isToday = day === today;
                const isSelected = day === selectedDay;
                const c = counts.get(day);
                const dayNum = Number(day.slice(8, 10));
                return (
                  <Link
                    key={day}
                    href={`/dashboard?date=${day}&calMonth=${day.slice(0, 7)}`}
                    className={`cal__cell ${inMonth ? 'in-month' : 'out-month'} ${
                      isSelected ? 'is-selected' : ''
                    } ${isToday ? 'is-today' : ''}`}
                  >
                    <span className={`cal__num ${isToday ? 'is-today-pip' : ''}`}>{dayNum}</span>
                    {c && c.total > 0 ? (
                      <div className="dc-pills expanded">
                        {c.unassigned > 0 ? (
                          <span className="dc-pill warning">
                            <span className="bullet" />
                            <span className="tabnum">{c.unassigned}</span>
                            <span>unassigned</span>
                          </span>
                        ) : null}
                        {c.assigned > 0 ? (
                          <span className="dc-pill muted">
                            <span className="bullet" />
                            <span className="tabnum">{c.assigned}</span>
                            <span>assigned</span>
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="dc-empty">No bookings</span>
                    )}
                  </Link>
                );
              })}
            </div>
            <div className="cal__foot">
              <Link className="cal__today" href={navHref(today.slice(0, 7), today)}>
                Jump to today
              </Link>
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
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Link
            className="btn btn--primary"
            href={`/dashboard?date=${selectedDay}&calMonth=${visibleMonth}`}
          >
            Open board for {selectedDay === today ? 'today' : 'selected day'} <Icon.ArrowRight />
          </Link>
        </div>
      </div>
    </>
  );
}
